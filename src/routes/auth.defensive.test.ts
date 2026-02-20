import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn((req, _res, next) => {
    req.user = undefined;
    next();
  }),
}));

vi.mock("../utils/sendVerificationEmail", () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock("../utils/sendResetEmail", () => ({
  sendResetEmail: vi.fn(),
}));

vi.mock("../server", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../utils/rateLimiting", () => ({
  checkRateLimit: vi.fn(),
  TIER_LIMITS: {
    HOBBY: {
      requestsPerHour: 20,
      requestsPerDay: 200,
      requestsPerMonth: 1000,
      allowLocationSearch: false,
      allowStats: false,
    },
    DEVELOPER: {
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      requestsPerMonth: 100000,
      allowLocationSearch: true,
      allowStats: true,
    },
    BUSINESS: {
      requestsPerHour: 5000,
      requestsPerDay: 50000,
      requestsPerMonth: 500000,
      allowLocationSearch: true,
      allowStats: true,
    },
  },
}));

import router from "./auth";

const app = express();
app.use(express.json());
app.use("/auth", router);

describe("Defensive auth handler guards", () => {
  it("returns 401 Not authenticated for GET /auth/me when req.user is missing", async () => {
    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 401 Not authenticated for GET /auth/dashboard when req.user is missing", async () => {
    const response = await request(app).get("/auth/dashboard");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });
});
