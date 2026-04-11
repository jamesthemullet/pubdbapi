import { Router, Response } from "express";
import { prisma } from "../prisma";
import {
  validateApiKey,
  requireTierAccess,
  enforceTierLimits,
  ApiKeyRequest,
} from "../middleware/apiKeyValidation";
import {
  listPubs,
  getPubById,
  parsePagination,
  PubListFilters,
} from "../queries/pubs";

const router = Router();

router.get(
  "/pubs",
  validateApiKey,
  enforceTierLimits,
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const {
        city,
        name,
        operator,
        borough,
        postcode,
        area,
        country,
        page,
        limit,
      } = req.query;

      const filters: PubListFilters = {
        city: city ? String(city) : undefined,
        name: name ? String(name) : undefined,
        operator: operator ? String(operator) : undefined,
        borough: borough ? String(borough) : undefined,
        postcode: postcode ? String(postcode) : undefined,
        area: area ? String(area) : undefined,
        country: country ? String(country) : undefined,
      };

      const { pageNum, limitNum, skip } = parsePagination(
        page as string | undefined,
        limit as string | undefined
      );

      const { pubs, total } = await listPubs(filters, { skip, limitNum });

      res.json({
        success: true,
        data: pubs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
          hasNext: pageNum < Math.ceil(total / limitNum),
          hasPrev: pageNum > 1,
        },
        filters: {
          city: city || null,
          name: name || null,
          operator: operator || null,
          borough: borough || null,
          postcode: postcode || null,
          area: area || null,
          country: country || null,
        },
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch pubs",
      });
    }
  }
);

router.get(
  "/pubs/near",
  validateApiKey,
  requireTierAccess("allowLocationSearch"),
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const { lat, lng, radius = "5", limit = "20" } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          error: "Bad request",
          message: "Latitude and longitude are required",
        });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      const radiusKm = parseFloat(radius as string);
      const limitNum = Math.min(parseInt(limit as string), 50);

      if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm)) {
        return res.status(400).json({
          success: false,
          error: "Bad request",
          message: "Invalid latitude, longitude, or radius values",
        });
      }

      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));

      const pubs = await prisma.pub.findMany({
        where: {
          lat: {
            gte: latitude - latDelta,
            lte: latitude + latDelta,
          },
          lng: {
            gte: longitude - lngDelta,
            lte: longitude + lngDelta,
          },
        },
        take: limitNum,
        orderBy: { name: "asc" },
      });

      const pubsWithDistance = pubs
        .map((pub) => {
          if (!pub.lat || !pub.lng) return null;

          const distance = calculateDistance(
            latitude,
            longitude,
            pub.lat,
            pub.lng
          );
          return {
            ...pub,
            distance: Math.round(distance * 100) / 100,
          };
        })
        .filter(
          (pub): pub is NonNullable<typeof pub> =>
            pub !== null && pub.distance <= radiusKm
        )
        .sort((a, b) => a.distance - b.distance);

      res.json({
        success: true,
        data: pubsWithDistance,
        search: {
          center: { lat: latitude, lng: longitude },
          radius: radiusKm,
          found: pubsWithDistance.length,
        },
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to search pubs by location",
      });
    }
  }
);

router.get(
  "/pubs/:id",
  validateApiKey,
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const { id } = req.params;
      const pub = await getPubById(id);

      if (!pub) {
        return res.status(404).json({
          success: false,
          error: "Not found",
          message: "Pub not found",
        });
      }

      res.json({
        success: true,
        data: pub,
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch pub",
      });
    }
  }
);

router.get(
  "/stats",
  validateApiKey,
  requireTierAccess("allowStats"),
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const [totalPubs, citiesCount, operatorsCount, boroughsCount] =
        await Promise.all([
          prisma.pub.count(),
          prisma.pub.groupBy({
            by: ["city"],
            _count: { city: true },
            where: { city: { not: "" } },
          }),
          prisma.pub.groupBy({
            by: ["operator"],
            where: { operator: { not: null } },
            _count: { operator: true },
          }),
          prisma.pub.groupBy({
            by: ["borough"],
            where: { borough: { not: null } },
            _count: { borough: true },
          }),
        ]);

      res.json({
        success: true,
        data: {
          overview: {
            totalPubs,
            totalCities: citiesCount.length,
            totalOperators: operatorsCount.length,
            totalBoroughs: boroughsCount.length,
          },
          topCities: citiesCount
            .sort((a, b) => (b._count?.city || 0) - (a._count?.city || 0))
            .slice(0, 10)
            .map((city) => ({
              name: city.city,
              count: city._count?.city || 0,
            })),
          topOperators: operatorsCount
            .sort((a, b) => b._count.operator - a._count.operator)
            .slice(0, 10)
            .map((op) => ({
              name: op.operator,
              count: op._count.operator,
            })),
          topBoroughs: boroughsCount
            .sort((a, b) => b._count.borough - a._count.borough)
            .slice(0, 10)
            .map((borough) => ({
              name: borough.borough,
              count: borough._count.borough,
            })),
        },
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch statistics",
      });
    }
  }
);

router.get(
  "/filters",
  validateApiKey,
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const [cities, operators, boroughs, areas] = await Promise.all([
        prisma.pub.findMany({
          select: { city: true },
          where: { city: { not: "" } },
          distinct: ["city"],
          orderBy: { city: "asc" },
        }),
        prisma.pub.findMany({
          select: { operator: true },
          where: { operator: { not: null } },
          distinct: ["operator"],
          orderBy: { operator: "asc" },
        }),
        prisma.pub.findMany({
          select: { borough: true },
          where: { borough: { not: null } },
          distinct: ["borough"],
          orderBy: { borough: "asc" },
        }),
        prisma.pub.findMany({
          select: { area: true },
          where: { area: { not: null } },
          distinct: ["area"],
          orderBy: { area: "asc" },
        }),
      ]);

      res.json({
        success: true,
        data: {
          cities: cities.map((c) => c.city).filter(Boolean),
          operators: operators.map((o) => o.operator).filter(Boolean),
          boroughs: boroughs.map((b) => b.borough).filter(Boolean),
          areas: areas.map((a) => a.area).filter(Boolean),
        },
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch filter options",
      });
    }
  }
);

router.get(
  "/beer-types",
  validateApiKey,
  async (req: ApiKeyRequest, res: Response) => {
    try {
      const beerTypes = await prisma.beerType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });

      res.json({
        success: true,
        data: beerTypes,
      });
    } catch (error) {
      console.error("Public API error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch beer types",
      });
    }
  }
);

router.get("/info", async (req: ApiKeyRequest, res: Response) => {
  res.json({
    success: true,
    api: {
      name: "Pub Database Public API",
      version: "1.0.0",
      description: "Public access to UK pub data",
      documentation:
        "https://github.com/jamesthemullet/pubdbapi/blob/main/docs/PUBLIC_API.md",
    },
    endpoints: {
      "GET /api/v1/pubs": "Get all pubs with optional filtering and pagination",
      "GET /api/v1/pubs/:id": "Get a specific pub by ID",
      "GET /api/v1/pubs/near": "Find pubs near a location (lat/lng)",
      "GET /api/v1/stats": "Get database statistics and top lists",
      "GET /api/v1/beer-types": "Get available beer types",
      "GET /api/v1/filters":
        "Get available filter values for cities, operators, etc.",
      "GET /api/v1/info": "Get API information",
    },
    usage: {
      authentication: "API key required for all endpoints except /info",
      apiKey:
        "Include API key in 'X-API-Key' header or 'api_key' query parameter",
      tiers: {
        TESTING:
          "50 req/hour, 200 req/day, 1K req/month, max 10 results, no location/stats",
        DEVELOPER:
          "1K req/hour, 10K req/day, 100K req/month, max 100 results, full access",
        BUSINESS:
          "5K req/hour, 50K req/day, 500K req/month, max 500 results, full access",
      },
      rateLimit: "Varies by tier, enforced hourly/daily/monthly",
      pagination: "Use 'page' and 'limit' parameters (max varies by tier)",
      filtering: "Multiple filters can be combined",
      location:
        "Use /pubs/near with lat, lng, and optional radius (km) - DEVELOPER+ only",
    },
  });
});

const calculateDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default router;
