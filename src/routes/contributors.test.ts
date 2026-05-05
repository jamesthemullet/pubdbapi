import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  auth: {
    mode: "ok" as "ok" | "missing" | "invalid",
  },
  prisma: {
    pub: {
      groupBy: vi.fn(),
    },
    auditLog: {
      groupBy: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../prisma", () => ({
  prisma: testState.prisma,
}));

vi.mock("../middleware/apiKeyValidation", () => ({
  validateApiKey: vi.fn((req: Request, res: Response, next: NextFunction) => {
    if (testState.auth.mode === "missing") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "API key is required. Include it in the X-API-Key header.",
      });
    }
    if (testState.auth.mode === "invalid") {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Invalid or expired API key.",
      });
    }
    next();
  }),
}));

import contributorsRoutes from "./contributors";

const app = express();
app.use(express.json());
app.use("/api/v1/contributors", contributorsRoutes);

describe("GET /api/v1/contributors/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.auth.mode = "ok";
  });

  it("returns 401 when API key is missing", async () => {
    testState.auth.mode = "missing";
    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("returns 401 when API key is invalid", async () => {
    testState.auth.mode = "invalid";
    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("returns ranked leaderboard combining pub additions and edits", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([
      { createdById: "user1", _count: { id: 10 } },
      { createdById: "user2", _count: { id: 3 } },
    ]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([
      { userId: "user1", _count: { id: 5 } },
      { userId: "user3", _count: { id: 20 } },
    ]);
    testState.prisma.user.findMany.mockResolvedValue([
      { id: "user1", name: "Alice", username: "alice" },
      { id: "user2", name: "Bob", username: "bob" },
      { id: "user3", name: null, username: "charlie" },
    ]);

    const res = await request(app).get("/api/v1/contributors/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { leaderboard } = res.body.data;
    expect(leaderboard).toHaveLength(3);

    // user3: 20 edits → rank 1
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[0].username).toBe("charlie");
    expect(leaderboard[0].totalEdits).toBe(20);
    expect(leaderboard[0].totalAdded).toBe(0);
    expect(leaderboard[0].totalContributions).toBe(20);

    // user1: 10 added + 5 edits = 15 → rank 2
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[1].username).toBe("alice");
    expect(leaderboard[1].totalAdded).toBe(10);
    expect(leaderboard[1].totalEdits).toBe(5);
    expect(leaderboard[1].totalContributions).toBe(15);

    // user2: 3 added → rank 3
    expect(leaderboard[2].rank).toBe(3);
    expect(leaderboard[2].username).toBe("bob");
    expect(leaderboard[2].totalAdded).toBe(3);
    expect(leaderboard[2].totalEdits).toBe(0);
  });

  it("uses displayName fallback to username when name is null", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([
      { createdById: "user1", _count: { id: 1 } },
    ]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue([
      { id: "user1", name: null, username: "nameless" },
    ]);

    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.body.data.leaderboard[0].displayName).toBe("nameless");
  });

  it("returns 'Unknown' when user record is missing", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([
      { createdById: "ghost", _count: { id: 1 } },
    ]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.body.data.leaderboard[0].displayName).toBe("Unknown");
  });

  it("returns 400 for invalid since date", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);

    const res = await request(app).get(
      "/api/v1/contributors/leaderboard?since=not-a-date"
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid 'since' date/);
  });

  it("passes sinceDate to Prisma queries when since is provided", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue([]);

    const since = "2026-01-01T00:00:00.000Z";
    const res = await request(app).get(
      `/api/v1/contributors/leaderboard?since=${since}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.since).toBe(since);

    const pubGroupByCall = testState.prisma.pub.groupBy.mock.calls[0][0];
    expect(pubGroupByCall.where.createdAt).toEqual({
      gte: new Date(since),
    });

    const auditGroupByCall = testState.prisma.auditLog.groupBy.mock.calls[0][0];
    expect(auditGroupByCall.where.timestamp).toEqual({
      gte: new Date(since),
    });
  });

  it("respects limit query param (max 50)", async () => {
    const manyUsers = Array.from({ length: 30 }, (_, i) => ({
      createdById: `user${i}`,
      _count: { id: 1 },
    }));
    testState.prisma.pub.groupBy.mockResolvedValue(manyUsers);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue(
      manyUsers.map((u) => ({
        id: u.createdById,
        name: u.createdById,
        username: u.createdById,
      }))
    );

    const res = await request(app).get(
      "/api/v1/contributors/leaderboard?limit=5"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard).toHaveLength(5);
  });

  it("caps limit at 50 even if higher value requested", async () => {
    const manyUsers = Array.from({ length: 60 }, (_, i) => ({
      createdById: `user${i}`,
      _count: { id: 1 },
    }));
    testState.prisma.pub.groupBy.mockResolvedValue(manyUsers);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue(
      manyUsers.map((u) => ({
        id: u.createdById,
        name: u.createdById,
        username: u.createdById,
      }))
    );

    const res = await request(app).get(
      "/api/v1/contributors/leaderboard?limit=100"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard).toHaveLength(50);
  });

  it("returns empty leaderboard when no contributions exist", async () => {
    testState.prisma.pub.groupBy.mockResolvedValue([]);
    testState.prisma.auditLog.groupBy.mockResolvedValue([]);
    testState.prisma.user.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.data.leaderboard).toHaveLength(0);
    expect(res.body.data.since).toBeNull();
  });

  it("returns 500 on database error", async () => {
    testState.prisma.pub.groupBy.mockRejectedValue(new Error("DB down"));

    const res = await request(app).get("/api/v1/contributors/leaderboard");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Failed to fetch contributor leaderboard");
  });
});
