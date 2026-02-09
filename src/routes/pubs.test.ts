import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./pubs";
import { prisma } from "../server";
import { requireAuth } from "../utils/authCheck";

vi.mock("../server", () => ({
  prisma: {
    pub: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn((req, res, next) => {
    req.user = { userId: "test-user-id", email: "test@example.com" };
    next();
  }),
}));

vi.mock("../utils/auditLog", () => ({
  createAuditLog: vi.fn(),
  getClientInfo: vi.fn(() => ({
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
  })),
}));

vi.mock("../utils/authCheck", () => ({
  requireAuth: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/pubs", router);

const mockedFindMany = prisma.pub.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCount = prisma.pub.count as unknown as ReturnType<typeof vi.fn>;
const mockedFindUnique = prisma.pub.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = prisma.pub.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCreate = prisma.pub.create as unknown as ReturnType<typeof vi.fn>;
const mockedRequireAuth = requireAuth as unknown as ReturnType<typeof vi.fn>;

describe("GET /pubs", () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
    mockedCount.mockReset();
    mockedFindUnique.mockReset();
    mockedFindFirst.mockReset();
    mockedCreate.mockReset();
  });

  it("applies city and name filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_1", name: "The Crown" },
    ] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get("/pubs?city=London&name=Crown");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "pub_1", name: "The Crown" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
      orderBy: { name: "asc" },
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
    });
  });

  it("applies operator, borough, postcode, area, and country filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_2", name: "The Red Lion" },
    ] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get(
      "/pubs?operator=Greene&borough=Camden&postcode=NW1%206XE&area=London&country=UK"
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "pub_2", name: "The Red Lion" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "UK", mode: "insensitive" },
      },
      orderBy: { name: "asc" },
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "UK", mode: "insensitive" },
      },
    });
  });
});

describe("GET /pubs/:id", () => {
  beforeEach(() => {
    mockedFindUnique.mockReset();
  });

  it("returns a pub with beer gardens and beer types", async () => {
    mockedFindUnique.mockResolvedValueOnce({
      id: "pub_1",
      name: "The Crown",
      beerGardens: [{ id: "bg_1", name: "Garden" }],
      beerTypes: [{ beerType: { id: "bt_1", name: "IPA" } }],
    } as any);

    const response = await request(app).get("/pubs/pub_1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: "pub_1",
      name: "The Crown",
      beerGardens: [{ id: "bg_1", name: "Garden" }],
      beerTypes: [{ beerType: { id: "bt_1", name: "IPA" } }],
    });
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "pub_1" },
      include: {
        beerGardens: true,
        beerTypes: { include: { beerType: true } },
      },
    });
  });

  it("returns 404 when pub is not found", async () => {
    mockedFindUnique.mockResolvedValueOnce(null as any);

    const response = await request(app).get("/pubs/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Pub not found" });
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "missing" },
      include: {
        beerGardens: true,
        beerTypes: { include: { beerType: true } },
      },
    });
  });
});

describe("POST /pubs", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
    mockedCreate.mockReset();
    mockedRequireAuth.mockReset();
    mockedRequireAuth.mockReturnValue(true);
  });

  it("creates a new pub successfully", async () => {
    const pubData = {
      name: "The Test Pub",
      city: "London",
      address: "123 Test Street",
      postcode: "SW1A 1AA",
      country: "UK",
    };

    const createdPub = { id: "pub_123", ...pubData };

    mockedFindFirst.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce(createdPub as any);

    const response = await request(app).post("/pubs").send(pubData);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createdPub);
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "The Test Pub", mode: "insensitive" },
        OR: [
          { address: { equals: "123 Test Street", mode: "insensitive" } },
          { postcode: "SW1A 1AA" },
        ],
      },
    });
    expect(mockedCreate).toHaveBeenCalledWith({ data: pubData });
  });

  it("returns 409 when pub with same name and location exists", async () => {
    const pubData = {
      name: "The Existing Pub",
      city: "London",
      address: "456 Existing Street",
      postcode: "SW1A 2BB",
      country: "UK",
    };

    const existingPub = { id: "pub_existing", ...pubData };

    mockedFindFirst.mockResolvedValueOnce(existingPub as any);

    const response = await request(app).post("/pubs").send(pubData);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Pub with this name already exists at this location",
      id: "pub_existing",
    });
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "The Existing Pub", mode: "insensitive" },
        OR: [
          { address: { equals: "456 Existing Street", mode: "insensitive" } },
          { postcode: "SW1A 2BB" },
        ],
      },
    });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid data", async () => {
    const invalidData = {
      name: "",
      city: "London",
      address: "123 Test Street",
      postcode: "SW1A 1AA",
      country: "UK",
    };

    const response = await request(app).post("/pubs").send(invalidData);

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("returns early when authentication fails", async () => {
    // Mock requireAuth to return false and simulate the 401 response
    mockedRequireAuth.mockImplementationOnce((req, res) => {
      res.status(401).json({ error: "Not authenticated" });
      return false;
    });

    const pubData = {
      name: "The Test Pub",
      city: "London",
      address: "123 Test Street",
      postcode: "SW1A 1AA",
      country: "UK",
    };

    const response = await request(app).post("/pubs").send(pubData);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
