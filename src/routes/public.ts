import { Router, Response, Request, NextFunction } from "express";
import { prisma } from "../server";

const router = Router();

// API Key validation middleware
const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message:
        "API key is required. Include it in the 'X-API-Key' header or 'api_key' query parameter.",
    });
  }

  // For now, we'll validate against environment variable or a simple check
  // In production, this would check against a database of valid API keys
  const validApiKey = process.env.PUBLIC_API_KEY || "demo-api-key-12345";

  if (apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "Invalid API key.",
    });
  }

  // API key is valid, continue to the route handler
  next();
};

// Get all pubs (public endpoint)
router.get("/pubs", validateApiKey, async (req: Request, res: Response) => {
  try {
    const {
      city,
      tag,
      name,
      page = "1",
      limit = "50",
      operator,
      borough,
      postcode,
      area,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100); // Max 100 per request
    const skip = (pageNum - 1) * limitNum;

    let where: any = {};

    // Filter by city
    if (city) {
      where.city = { contains: String(city), mode: "insensitive" };
    }

    // Filter by tag
    if (tag) {
      where.tags = { has: String(tag) };
    }

    // Filter by pub name
    if (name) {
      where.name = {
        contains: String(name),
        mode: "insensitive",
      };
    }

    // Filter by operator/brewery
    if (operator) {
      where.operator = {
        contains: String(operator),
        mode: "insensitive",
      };
    }

    // Filter by borough
    if (borough) {
      where.borough = {
        contains: String(borough),
        mode: "insensitive",
      };
    }

    // Filter by postcode
    if (postcode) {
      where.postcode = {
        contains: String(postcode),
        mode: "insensitive",
      };
    }

    // Filter by area
    if (area) {
      where.area = {
        contains: String(area),
        mode: "insensitive",
      };
    }

    const [pubs, total] = await Promise.all([
      prisma.pub.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { name: "asc" },
      }),
      prisma.pub.count({ where }),
    ]);

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
        tag: tag || null,
        name: name || null,
        operator: operator || null,
        borough: borough || null,
        postcode: postcode || null,
        area: area || null,
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
});

// Get single pub by ID (public endpoint)
router.get("/pubs/:id", validateApiKey, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const pub = await prisma.pub.findUnique({ where: { id } });

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
});

// Search pubs by location (latitude/longitude proximity)
router.get(
  "/pubs/near",
  validateApiKey,
  async (req: Request, res: Response) => {
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

      // Find pubs with lat/lng within approximate radius
      // This is a simple bounding box calculation - for production you might want PostGIS
      const latDelta = radiusKm / 111; // Rough conversion: 1 degree ≈ 111km
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

      // Calculate actual distance and sort by distance
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
            distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
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

// Get pub statistics (public endpoint)
router.get("/stats", validateApiKey, async (req: Request, res: Response) => {
  try {
    const [totalPubs, citiesCount, operatorsCount, boroughsCount, tagsCount] =
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
        prisma.pub.findMany({
          select: { tags: true },
          where: {
            tags: {
              isEmpty: false,
            },
          },
        }),
      ]);

    // Calculate unique tags
    const allTags = tagsCount.flatMap((pub) => pub.tags);
    const uniqueTags = [...new Set(allTags)];

    res.json({
      success: true,
      data: {
        overview: {
          totalPubs,
          totalCities: citiesCount.length,
          totalOperators: operatorsCount.length,
          totalBoroughs: boroughsCount.length,
          totalTags: uniqueTags.length,
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
        popularTags: uniqueTags
          .map((tag) => ({
            name: tag,
            count: allTags.filter((t) => t === tag).length,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20),
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
});

// Get unique values for filtering
router.get("/filters", validateApiKey, async (req: Request, res: Response) => {
  try {
    const [cities, operators, boroughs, areas, allTags] = await Promise.all([
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
      prisma.pub.findMany({
        select: { tags: true },
        where: {
          tags: {
            isEmpty: false,
          },
        },
      }),
    ]);

    // Get unique tags
    const tags = [...new Set(allTags.flatMap((pub) => pub.tags))].sort();

    res.json({
      success: true,
      data: {
        cities: cities.map((c) => c.city).filter(Boolean),
        operators: operators.map((o) => o.operator).filter(Boolean),
        boroughs: boroughs.map((b) => b.borough).filter(Boolean),
        areas: areas.map((a) => a.area).filter(Boolean),
        tags: tags,
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
});

// API information endpoint
router.get("/info", async (req: Request, res: Response) => {
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
      "GET /api/v1/filters":
        "Get available filter values for cities, operators, etc.",
      "GET /api/v1/info": "Get API information",
    },
    usage: {
      authentication: "API key required for all endpoints except /info",
      apiKey:
        "Include API key in 'X-API-Key' header or 'api_key' query parameter",
      rateLimit: "Currently no rate limiting (subject to change)",
      pagination: "Use 'page' and 'limit' parameters (max 100 items per page)",
      filtering: "Multiple filters can be combined",
      location: "Use /pubs/near with lat, lng, and optional radius (km)",
    },
  });
});

const calculateDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
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
