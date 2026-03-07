import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  auth: {
    mode: "ok" as "ok" | "missing" | "invalid",
    blockedFeatures: new Set<string>(),
  },
  prisma: {
    pub: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    beerType: {
      findMany: vi.fn(),
    },
  },
  queries: {
    listPubs: vi.fn(),
    getPubById: vi.fn(),
    parsePagination: vi.fn(),
  },
}));

vi.mock("../server", () => ({
  prisma: testState.prisma,
}));

vi.mock("../queries/pubs", () => ({
  listPubs: testState.queries.listPubs,
  getPubById: testState.queries.getPubById,
  parsePagination: testState.queries.parsePagination,
}));

vi.mock("../middleware/apiKeyValidation", () => ({
  validateApiKey: vi.fn((req, res, next) => {
    if (testState.auth.mode === "missing") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message:
          "API key is required. Include it in the X-API-Key header or api_key query parameter.",
      });
    }

    if (testState.auth.mode === "invalid") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Invalid or expired API key.",
      });
    }

    req.apiKey = {
      id: "k_1",
      userId: "u_1",
      tier: "DEVELOPER",
      limits: {
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000,
        maxResultsPerRequest: 100,
        allowLocationSearch: true,
        allowStats: true,
      },
    };
    next();
  }),
  requireTierAccess: vi.fn((requiredFeature: string) => {
    return (_req, res, next) => {
      if (testState.auth.blockedFeatures.has(requiredFeature)) {
        return res.status(403).json({
          success: false,
          error: "Forbidden",
          message: `This feature is not available in your testing tier. Please upgrade your plan.`,
          tier: "TESTING",
          availableIn: ["DEVELOPER", "BUSINESS"],
        });
      }
      next();
    };
  }),
  enforceTierLimits: vi.fn((_req, _res, next) => next()),
}));

let app: express.Express;

beforeAll(async () => {
  const { default: router } = await import("./public");

  app = express();
  app.use(express.json());
  app.use("/api/v1", router);
});

const mockedPubFindMany = testState.prisma.pub
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedPubCount = testState.prisma.pub.count as unknown as ReturnType<
  typeof vi.fn
>;
const mockedPubGroupBy = testState.prisma.pub.groupBy as unknown as ReturnType<
  typeof vi.fn
>;
const mockedBeerTypeFindMany = testState.prisma.beerType
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedListPubs = testState.queries.listPubs as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetPubById = testState.queries.getPubById as unknown as ReturnType<
  typeof vi.fn
>;
const mockedParsePagination = testState.queries
  .parsePagination as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/v1/pubs", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    testState.auth.blockedFeatures.clear();
    mockedListPubs.mockReset();
    mockedParsePagination.mockReset();

    mockedParsePagination.mockReturnValue({
      pageNum: 1,
      limitNum: 50,
      skip: 0,
    });
    mockedListPubs.mockResolvedValue({
      pubs: [{ id: "pub_1", name: "The Crown" }],
      total: 1,
    });
  });

  it("returns paginated pubs with filters", async () => {
    const response = await request(app).get(
      "/api/v1/pubs?city=London&name=Crown&page=2&limit=10"
    );

    expect(response.status).toBe(200);
    expect(mockedParsePagination).toHaveBeenCalledWith("2", "10");
    expect(mockedListPubs).toHaveBeenCalledWith(
      {
        city: "London",
        name: "Crown",
        operator: undefined,
        borough: undefined,
        postcode: undefined,
        area: undefined,
        country: undefined,
      },
      { skip: 0, limitNum: 50 }
    );
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([{ id: "pub_1", name: "The Crown" }]);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
    });
  });

  it("maps all remaining filter query params", async () => {
    const response = await request(app).get(
      "/api/v1/pubs?operator=Stonegate&borough=Camden&postcode=NW1%206XE&area=North&country=GB"
    );

    expect(response.status).toBe(200);
    expect(mockedListPubs).toHaveBeenCalledWith(
      {
        city: undefined,
        name: undefined,
        operator: "Stonegate",
        borough: "Camden",
        postcode: "NW1 6XE",
        area: "North",
        country: "GB",
      },
      { skip: 0, limitNum: 50 }
    );
  });

  it("returns null filters when query params are missing", async () => {
    const response = await request(app).get("/api/v1/pubs");

    expect(response.status).toBe(200);
    expect(response.body.filters).toEqual({
      city: null,
      name: null,
      operator: null,
      borough: null,
      postcode: null,
      area: null,
      country: null,
    });
  });

  it("returns 401 when api key is missing", async () => {
    testState.auth.mode = "missing";

    const response = await request(app).get("/api/v1/pubs");

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: "Unauthorized",
    });
    expect(mockedListPubs).not.toHaveBeenCalled();
  });

  it("returns 500 when list query fails", async () => {
    mockedListPubs.mockRejectedValueOnce(new Error("db failed"));

    const response = await request(app).get("/api/v1/pubs");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch pubs",
    });
  });
});

describe("GET /api/v1/pubs/near", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    testState.auth.blockedFeatures.clear();
    mockedPubFindMany.mockReset();
  });

  it("returns 400 when lat/lng are missing", async () => {
    const response = await request(app).get("/api/v1/pubs/near");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "Bad request",
      message: "Latitude and longitude are required",
    });
  });

  it("returns 400 when lat/lng are invalid", async () => {
    const response = await request(app).get(
      "/api/v1/pubs/near?lat=abc&lng=-0.141890"
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: "Bad request",
      message: "Invalid latitude, longitude, or radius values",
    });
  });

  it("returns 403 when tier lacks location access", async () => {
    testState.auth.blockedFeatures.add("allowLocationSearch");

    const response = await request(app).get(
      "/api/v1/pubs/near?lat=51.501366&lng=-0.141890"
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: "Forbidden",
    });
  });

  it("returns nearby pubs with computed distance", async () => {
    mockedPubFindMany.mockResolvedValueOnce([
      { id: "a", name: "Near", lat: 51.501366, lng: -0.14189 },
      { id: "b", name: "Far", lat: 52.5, lng: -0.12 },
      { id: "c", name: "No coords", lat: null, lng: null },
    ] as any);

    const response = await request(app).get(
      "/api/v1/pubs/near?lat=51.501366&lng=-0.141890&radius=5&limit=20"
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: "a", name: "Near" });
    expect(response.body.search).toMatchObject({ radius: 5, found: 1 });
    expect(mockedPubFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        orderBy: { name: "asc" },
      })
    );
  });

  it("sorts nearby pubs by ascending distance", async () => {
    mockedPubFindMany.mockResolvedValueOnce([
      { id: "far", name: "Farther", lat: 51.511366, lng: -0.14189 },
      { id: "close", name: "Closer", lat: 51.501366, lng: -0.14189 },
    ] as any);

    const response = await request(app).get(
      "/api/v1/pubs/near?lat=51.501366&lng=-0.141890&radius=5"
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].id).toBe("close");
    expect(response.body.data[1].id).toBe("far");
    expect(response.body.data[0].distance).toBeLessThanOrEqual(
      response.body.data[1].distance
    );
  });

  it("returns 500 when near lookup fails", async () => {
    mockedPubFindMany.mockRejectedValueOnce(new Error("db failed"));

    const response = await request(app).get(
      "/api/v1/pubs/near?lat=51.501366&lng=-0.141890"
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to search pubs by location",
    });
  });
});

describe("GET /api/v1/pubs/:id", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    mockedGetPubById.mockReset();
  });

  it("returns a single pub", async () => {
    mockedGetPubById.mockResolvedValueOnce({ id: "pub_1", name: "The Crown" });

    const response = await request(app).get("/api/v1/pubs/pub_1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { id: "pub_1", name: "The Crown" },
    });
    expect(mockedGetPubById).toHaveBeenCalledWith("pub_1");
  });

  it("returns 404 when pub is missing", async () => {
    mockedGetPubById.mockResolvedValueOnce(null);

    const response = await request(app).get("/api/v1/pubs/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: "Not found",
      message: "Pub not found",
    });
  });

  it("returns 500 when lookup throws", async () => {
    mockedGetPubById.mockRejectedValueOnce(new Error("boom"));

    const response = await request(app).get("/api/v1/pubs/pub_1");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch pub",
    });
  });
});

describe("GET /api/v1/stats", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    testState.auth.blockedFeatures.clear();
    mockedPubCount.mockReset();
    mockedPubGroupBy.mockReset();
  });

  it("returns aggregate stats with sorted top lists", async () => {
    mockedPubCount.mockResolvedValueOnce(100 as any);
    mockedPubGroupBy
      .mockResolvedValueOnce([
        { city: "NoCountCity" },
        { city: "London", _count: { city: 80 } },
        { city: "Bristol", _count: { city: 20 } },
      ] as any)
      .mockResolvedValueOnce([
        { operator: "Small Group", _count: { operator: 2 } },
        { operator: "Stonegate", _count: { operator: 12 } },
        { operator: "Medium Group", _count: { operator: 7 } },
      ] as any)
      .mockResolvedValueOnce([
        { borough: "Hackney", _count: { borough: 3 } },
        { borough: "Camden", _count: { borough: 9 } },
        { borough: "Westminster", _count: { borough: 6 } },
      ] as any);

    const response = await request(app).get("/api/v1/stats");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.overview).toEqual({
      totalPubs: 100,
      totalCities: 3,
      totalOperators: 3,
      totalBoroughs: 3,
    });
    expect(response.body.data.topCities).toEqual([
      { name: "London", count: 80 },
      { name: "Bristol", count: 20 },
      { name: "NoCountCity", count: 0 },
    ]);
    expect(response.body.data.topOperators).toEqual([
      { name: "Stonegate", count: 12 },
      { name: "Medium Group", count: 7 },
      { name: "Small Group", count: 2 },
    ]);
    expect(response.body.data.topBoroughs).toEqual([
      { name: "Camden", count: 9 },
      { name: "Westminster", count: 6 },
      { name: "Hackney", count: 3 },
    ]);
  });

  it("returns 403 when tier lacks stats access", async () => {
    testState.auth.blockedFeatures.add("allowStats");

    const response = await request(app).get("/api/v1/stats");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: "Forbidden",
    });
  });

  it("returns 500 when stats query fails", async () => {
    mockedPubCount.mockRejectedValueOnce(new Error("db down"));

    const response = await request(app).get("/api/v1/stats");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch statistics",
    });
  });
});

describe("GET /api/v1/filters", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    mockedPubFindMany.mockReset();
  });

  it("returns distinct filter values", async () => {
    mockedPubFindMany
      .mockResolvedValueOnce([{ city: "London" }, { city: "" }] as any)
      .mockResolvedValueOnce([
        { operator: "Stonegate" },
        { operator: null },
      ] as any)
      .mockResolvedValueOnce([{ borough: "Camden" }, { borough: null }] as any)
      .mockResolvedValueOnce([{ area: "Westminster" }, { area: null }] as any);

    const response = await request(app).get("/api/v1/filters");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        cities: ["London"],
        operators: ["Stonegate"],
        boroughs: ["Camden"],
        areas: ["Westminster"],
      },
    });
  });

  it("returns 500 when filter lookup fails", async () => {
    mockedPubFindMany.mockRejectedValueOnce(new Error("db failed"));

    const response = await request(app).get("/api/v1/filters");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch filter options",
    });
  });
});

describe("GET /api/v1/beer-types", () => {
  beforeEach(() => {
    testState.auth.mode = "ok";
    mockedBeerTypeFindMany.mockReset();
  });

  it("returns active beer types", async () => {
    mockedBeerTypeFindMany.mockResolvedValueOnce([
      { id: "bt_1", name: "IPA", isActive: true },
    ] as any);

    const response = await request(app).get("/api/v1/beer-types");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [{ id: "bt_1", name: "IPA", isActive: true }],
    });
    expect(mockedBeerTypeFindMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  });

  it("returns 500 when beer type lookup fails", async () => {
    mockedBeerTypeFindMany.mockRejectedValueOnce(new Error("db failed"));

    const response = await request(app).get("/api/v1/beer-types");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to fetch beer types",
    });
  });
});

describe("GET /api/v1/info", () => {
  beforeEach(() => {
    testState.auth.mode = "missing";
  });

  it("returns API info without requiring a key", async () => {
    const response = await request(app).get("/api/v1/info");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.api.name).toBe("Pub Database Public API");
    expect(response.body.endpoints["GET /api/v1/pubs"]).toBeDefined();
  });
});
