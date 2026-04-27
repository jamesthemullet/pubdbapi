import express from "express";
import qs from "qs";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./pubs";
import { prisma } from "../prisma";
import { requireAuth } from "../utils/authCheck";
import { createAuditLog, getChangedFields } from "../utils/auditLog";
import { pubBeerTypesPatchSchema } from "../types";

vi.mock("../prisma", () => ({
  prisma: {
    pub: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    beerGarden: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pubBeerType: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    beerType: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
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
  getChangedFields: vi.fn(),
}));

vi.mock("../utils/authCheck", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("../types", async () => {
  const actual = await vi.importActual<typeof import("../types")>("../types");
  return {
    ...actual,
    pubBeerTypesPatchSchema: {
      // provide a mockable wrapper and expose the real safeParse as __actualSafeParse
      safeParse: vi.fn(actual.pubBeerTypesPatchSchema.safeParse),
      __actualSafeParse: actual.pubBeerTypesPatchSchema.safeParse,
    },
  };
});

const app = express();
app.set("query parser", (str: string) => qs.parse(str));
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
const mockedDeletePub = prisma.pub.delete as unknown as ReturnType<
  typeof vi.fn
>;
const mockedRequireAuth = requireAuth as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.pub.update as unknown as ReturnType<typeof vi.fn>;
const mockedTransaction = prisma.$transaction as unknown as ReturnType<
  typeof vi.fn
>;
const mockedBeerGardenFindFirst = prisma.beerGarden
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedBeerGardenUpdate = prisma.beerGarden
  .update as unknown as ReturnType<typeof vi.fn>;
const mockedBeerGardenDelete = prisma.beerGarden
  .delete as unknown as ReturnType<typeof vi.fn>;
const mockedBeerGardenCreate = prisma.beerGarden
  .create as unknown as ReturnType<typeof vi.fn>;
const mockedBeerTypeFindUnique = prisma.beerType
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPubBeerTypeFindUnique = prisma.pubBeerType
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPubBeerTypeDelete = prisma.pubBeerType
  .delete as unknown as ReturnType<typeof vi.fn>;
const mockedPubBeerTypeUpsert = prisma.pubBeerType
  .upsert as unknown as ReturnType<typeof vi.fn>;
const mockedUserFindUnique = prisma.user.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCreateAuditLog = createAuditLog as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetChangedFields = getChangedFields as unknown as ReturnType<
  typeof vi.fn
>;
const mockedBeerTypesSafeParse = (
  pubBeerTypesPatchSchema as unknown as { safeParse: ReturnType<typeof vi.fn> }
).safeParse;

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
      skip: 0,
      take: 50,
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
    });
  });

  it("applies amenity filters parsed from query params", async () => {
    mockedFindMany.mockResolvedValueOnce([{ id: "pub_3", name: "The Dog" }] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get(
      "/pubs?amenities%5BhasFood%5D=true&amenities%5BisDogFriendly%5D=true&amenities%5BhasLiveMusic%5D=false"
    );

    expect(response.status).toBe(200);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        hasFood: true,
        isDogFriendly: true,
        hasLiveMusic: false,
      },
      orderBy: { name: "asc" },
      skip: 0,
      take: 50,
    });
    expect(response.body.filters).toMatchObject({
      hasFood: true,
      isDogFriendly: true,
      hasLiveMusic: false,
    });
  });

  it("ignores amenity query params with non-boolean values", async () => {
    mockedFindMany.mockResolvedValueOnce([] as any);
    mockedCount.mockResolvedValueOnce(0 as any);

    const response = await request(app).get(
      "/pubs?amenities%5BhasFood%5D=yes&amenities%5BisDogFriendly%5D=1"
    );

    expect(response.status).toBe(200);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { name: "asc" },
      skip: 0,
      take: 50,
    });
  });

  it("includes all amenity keys as null in filters when none supplied", async () => {
    mockedFindMany.mockResolvedValueOnce([] as any);
    mockedCount.mockResolvedValueOnce(0 as any);

    const response = await request(app).get("/pubs");

    expect(response.status).toBe(200);
    expect(response.body.filters).toMatchObject({
      isIndependent: null,
      hasFood: null,
      hasSundayRoast: null,
      hasBeerGarden: null,
      hasCaskAle: null,
      isBeerFocused: null,
      isDogFriendly: null,
      isFamilyFriendly: null,
      hasStepFreeAccess: null,
      hasAccessibleToilet: null,
      hasLiveSport: null,
      hasLiveMusic: null,
    });
  });

  it("applies operator, borough, postcode, area, and country filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_2", name: "The Red Lion" },
    ] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get(
      "/pubs?operator=Greene&borough=Camden&postcode=NW1%206XE&area=London&country=GB"
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "pub_2", name: "The Red Lion" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "GB", mode: "insensitive" },
      },
      orderBy: { name: "asc" },
      skip: 0,
      take: 50,
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "GB", mode: "insensitive" },
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
      country: "GB",
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
      country: "GB",
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
      country: "GB",
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
      country: "GB",
    };

    const response = await request(app).post("/pubs").send(pubData);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH /pubs/:id", () => {
  beforeEach(() => {
    mockedFindUnique.mockReset();
    mockedUpdate.mockReset();
    mockedTransaction.mockReset();
    mockedCreateAuditLog.mockReset();
    mockedGetChangedFields.mockReset();
    mockedRequireAuth.mockReset();
    mockedRequireAuth.mockReturnValue(true);
    mockedBeerTypesSafeParse.mockReset();
    mockedBeerTypesSafeParse.mockImplementation(
      (pubBeerTypesPatchSchema as any).__actualSafeParse
    );
  });

  it("returns early when authentication fails", async () => {
    mockedRequireAuth.mockImplementationOnce((req, res) => {
      res.status(401).json({ error: "Not authenticated" });
      return false;
    });

    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ name: "Updated Pub" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid data", async () => {
    const response = await request(app).patch("/pubs/pub_1").send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid beer gardens payload", async () => {
    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerGardens: "not-an-array" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid beer types payload", async () => {
    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerTypes: "not-an-array" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("errors");
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when beer garden delete is missing id", async () => {
    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerGardens: [{ _delete: true }] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Beer garden id is required for delete",
    });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when beer garden create is missing name", async () => {
    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerGardens: [{}] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Beer garden name is required for create",
    });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when beer type delete is missing id", async () => {
    mockedBeerTypesSafeParse.mockReturnValueOnce({
      success: true,
      data: [{ _delete: true }],
    });

    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerTypes: [{ _delete: true }] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Beer type id is required for delete",
    });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when beer type create is missing id", async () => {
    mockedBeerTypesSafeParse.mockReturnValueOnce({
      success: true,
      data: [{}],
    });

    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ beerTypes: [{}] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Beer type id is required for create",
    });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when pub is not found", async () => {
    mockedFindUnique.mockResolvedValueOnce(null as any);

    const response = await request(app)
      .patch("/pubs/missing")
      .send({ name: "Updated Pub" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Pub not found" });
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "missing" },
      include: {
        beerGardens: { select: { id: true } },
        beerTypes: { select: { beerTypeId: true } },
      },
    });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("handles missing body payload", async () => {
    mockedFindUnique.mockResolvedValueOnce(null as any);

    const response = await request(app).patch("/pubs/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Pub not found" });
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "missing" },
      include: {
        beerGardens: { select: { id: true } },
        beerTypes: { select: { beerTypeId: true } },
      },
    });
  });

  it("nulls non-system fields omitted from payload - effectively ability to delete a field", async () => {
    const originalPub = {
      id: "pub_2",
      name: "Original Name",
      operator: "Old Operator",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [],
      beerTypes: [],
    } as any;

    const updatedPub = {
      id: "pub_2",
      name: "New Name",
      operator: null,
      beerGardens: [],
      beerTypes: [],
    } as any;

    // Return the original pub for both reads to ensure the flow continues
    mockedFindUnique.mockResolvedValue(originalPub);

    const tx = {
      pub: { update: vi.fn() },
      beerGarden: {
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      pubBeerType: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockedTransaction.mockImplementation(async (callback) => callback(tx));
    mockedGetChangedFields.mockReturnValue({
      oldValues: { name: "Original Name" },
      newValues: { name: "New Name" },
    });

    const response = await request(app)
      .patch("/pubs/pub_2")
      .send({ name: "New Name" });

    expect(response.status).toBe(200);
    // tx.pub.update should be called with data.operator === null
    expect(tx.pub.update).toHaveBeenCalled();
    const updateArg = (tx.pub.update as any).mock.calls[0][0];
    expect(updateArg.data).toHaveProperty("operator", null);
  });

  it("updates the pub and returns the updated record", async () => {
    const originalPub = {
      id: "pub_1",
      name: "Old Name",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [],
      beerTypes: [],
    } as any;

    const updatedPub = {
      id: "pub_1",
      name: "Updated Name",
      beerGardens: [],
      beerTypes: [],
    } as any;

    mockedFindUnique
      .mockResolvedValueOnce(originalPub)
      .mockResolvedValueOnce(updatedPub);

    const tx = {
      pub: { update: vi.fn() },
      beerGarden: {
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      pubBeerType: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockedTransaction.mockImplementation(async (callback) => callback(tx));
    mockedGetChangedFields.mockReturnValue({
      oldValues: { name: "Old Name" },
      newValues: { name: "Updated Name" },
    });

    const response = await request(app)
      .patch("/pubs/pub_1")
      .send({ name: "Updated Name" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedPub);
    expect(tx.pub.update).toHaveBeenCalled();
    expect(mockedCreateAuditLog).toHaveBeenCalled();
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "pub_1" },
      include: {
        beerGardens: true,
        beerTypes: { include: { beerType: true } },
      },
    });
  });

  it("returns 404 when update transaction fails", async () => {
    const originalPub = {
      id: "pub_fail",
      name: "Original",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [],
      beerTypes: [],
    } as any;

    mockedFindUnique.mockResolvedValueOnce(originalPub);
    mockedTransaction.mockRejectedValueOnce(new Error("db error"));

    const response = await request(app)
      .patch("/pubs/pub_fail")
      .send({ name: "Updated" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Pub not found or update failed",
    });
  });

  it("removes beer gardens and beer types omitted from payload", async () => {
    const originalPub = {
      id: "pub_omit",
      name: "Original",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [{ id: "bg_keep" }, { id: "bg_remove" }],
      beerTypes: [
        { beerTypeId: "bt_keep" },
        { beerTypeId: "bt_remove" },
      ],
    } as any;

    const updatedPub = {
      id: "pub_omit",
      name: "Updated",
      beerGardens: [{ id: "bg_keep" }],
      beerTypes: [{ beerType: { id: "bt_keep" } }],
    } as any;

    mockedFindUnique
      .mockResolvedValueOnce(originalPub)
      .mockResolvedValueOnce(updatedPub);

    const tx = {
      pub: { update: vi.fn() },
      beerGarden: {
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      pubBeerType: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockedTransaction.mockImplementation(async (callback) => callback(tx));
    mockedGetChangedFields.mockReturnValue({
      oldValues: { name: "Original" },
      newValues: { name: "Updated" },
    });

    const response = await request(app)
      .patch("/pubs/pub_omit")
      .send({
        name: "Updated",
        beerGardens: [{ id: "bg_keep", name: "Keep" }],
        beerTypes: [{ beerTypeId: "bt_keep" }],
      });

    expect(response.status).toBe(200);
    expect(tx.beerGarden.deleteMany).toHaveBeenCalledWith({
      where: { pubId: "pub_omit", id: { in: ["bg_remove"] } },
    });
    expect(tx.pubBeerType.deleteMany).toHaveBeenCalledWith({
      where: { pubId: "pub_omit", beerTypeId: { in: ["bt_remove"] } },
    });
  });

  it("applies beer garden and beer type operations", async () => {
    const originalPub = {
      id: "pub_9",
      name: "Original",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [],
      beerTypes: [],
    } as any;

    const updatedPub = {
      id: "pub_9",
      name: "Updated",
      beerGardens: [],
      beerTypes: [],
    } as any;

    mockedFindUnique
      .mockResolvedValueOnce(originalPub)
      .mockResolvedValueOnce(updatedPub);

    const tx = {
      pub: { update: vi.fn() },
      beerGarden: {
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      pubBeerType: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockedTransaction.mockImplementation(async (callback) => callback(tx));
    mockedGetChangedFields.mockReturnValue({
      oldValues: { name: "Original" },
      newValues: { name: "Updated" },
    });

    const response = await request(app)
      .patch("/pubs/pub_9")
      .send({
        name: "Updated",
        beerGardens: [
          { id: "bg_del", _delete: true },
          {
            id: "bg_upd",
            name: "Updated Garden",
            openingHours: { mon: { open: "10:00", close: "18:00" } },
          },
          { name: "New Garden", seatingCapacity: 10 },
        ],
        beerTypes: [
          { beerTypeId: "bt_del", _delete: true },
          { beerTypeId: "bt_upsert" },
        ],
      });

    expect(response.status).toBe(200);
    expect(tx.beerGarden.deleteMany).toHaveBeenCalledWith({
      where: { id: "bg_del", pubId: "pub_9" },
    });
    expect(tx.beerGarden.updateMany).toHaveBeenCalledWith({
      where: { id: "bg_upd", pubId: "pub_9" },
      data: expect.objectContaining({
        name: "Updated Garden",
        openingHours: { mon: { open: "10:00", close: "18:00" } },
      }),
    });
    expect(tx.beerGarden.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pubId: "pub_9",
        name: "New Garden",
        seatingCapacity: 10,
      }),
    });
    expect(tx.pubBeerType.deleteMany).toHaveBeenCalledWith({
      where: { pubId: "pub_9", beerTypeId: "bt_del" },
    });
    expect(tx.pubBeerType.upsert).toHaveBeenCalledWith({
      where: {
        pubId_beerTypeId: { pubId: "pub_9", beerTypeId: "bt_upsert" },
      },
      create: { pubId: "pub_9", beerTypeId: "bt_upsert" },
      update: {},
    });
  });

  it("returns 404 when updated pub cannot be loaded", async () => {
    const originalPub = {
      id: "pub_10",
      name: "Original",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      beerGardens: [],
      beerTypes: [],
    } as any;

    mockedFindUnique
      .mockResolvedValueOnce(originalPub)
      .mockResolvedValueOnce(null as any);

    const tx = {
      pub: { update: vi.fn() },
      beerGarden: {
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      pubBeerType: {
        deleteMany: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockedTransaction.mockImplementation(async (callback) => callback(tx));

    const response = await request(app)
      .patch("/pubs/pub_10")
      .send({ name: "Updated" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Pub not found" });
    expect(mockedCreateAuditLog).not.toHaveBeenCalled();
  });
});

describe("DELETE /pubs/:id", () => {
  beforeEach(() => {
    mockedRequireAuth.mockReset();
    mockedRequireAuth.mockReturnValue(true);
    mockedUserFindUnique.mockReset();
    mockedFindUnique.mockReset();
    mockedDeletePub.mockReset();
    mockedCreateAuditLog.mockReset();
  });

  it("deletes a pub when the user is approved", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      admin: false,
      approved: true,
    } as any);
    mockedFindUnique.mockResolvedValueOnce({
      id: "pub_16",
      name: "Delete Me",
    } as any);

    const response = await request(app).delete("/pubs/pub_16");

    expect(response.status).toBe(200);
    expect(mockedDeletePub).toHaveBeenCalledWith({ where: { id: "pub_16" } });
    expect(mockedCreateAuditLog).toHaveBeenCalled();
  });

  it("returns 403 when user lacks access", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      admin: false,
      approved: false,
    } as any);

    const response = await request(app).delete("/pubs/pub_17");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Admin or approved user access required",
    });
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedDeletePub).not.toHaveBeenCalled();
  });

  it("returns 404 when pub does not exist", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      admin: true,
      approved: false,
    } as any);
    mockedFindUnique.mockResolvedValueOnce(null as any);

    const response = await request(app).delete("/pubs/pub_18");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Pub not found" });
    expect(mockedDeletePub).not.toHaveBeenCalled();
  });

  it("returns 404 when delete fails", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      admin: true,
      approved: false,
    } as any);
    mockedFindUnique.mockResolvedValueOnce({
      id: "pub_19",
      name: "Delete Me",
    } as any);
    mockedDeletePub.mockRejectedValueOnce(new Error("db error"));

    const response = await request(app).delete("/pubs/pub_19");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Pub not found" });
  });

  it("returns early when authentication fails", async () => {
    mockedRequireAuth.mockImplementationOnce((req, res) => {
      res.status(401).json({ error: "Not authenticated" });
      return false;
    });

    const response = await request(app).delete("/pubs/pub_20");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedDeletePub).not.toHaveBeenCalled();
  });
});
