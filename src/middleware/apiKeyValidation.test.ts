import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const { mockApiKeyFindFirst, mockCheckRateLimit, mockRecordApiUsage } =
  vi.hoisted(() => ({
    mockApiKeyFindFirst: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockRecordApiUsage: vi.fn(),
  }));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    apiKey = {
      findFirst: mockApiKeyFindFirst,
    };
  },
  ApiKeyTier: {
    HOBBY: "HOBBY",
    DEVELOPER: "DEVELOPER",
    BUSINESS: "BUSINESS",
  },
}));

vi.mock("../utils/rateLimiting", () => ({
  checkRateLimit: mockCheckRateLimit,
  recordApiUsage: mockRecordApiUsage,
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

import {
  requireTierAccess,
  validateApiKey,
} from "./apiKeyValidation";

function createResponse() {
  const listeners = new Map<string, Function>();
  const res: any = {
    statusCode: 200,
    _listeners: listeners,
  };

  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  res.on = vi.fn().mockImplementation((event: string, cb: Function) => {
    listeners.set(event, cb);
    return res;
  });

  return res;
}

function createRateLimitResult(allowed: boolean) {
  return {
    allowed,
    remaining: { hour: 10, day: 90, month: 900 },
    resetTimes: {
      hour: new Date("2026-03-06T11:00:00.000Z"),
      day: new Date("2026-03-07T00:00:00.000Z"),
      month: new Date("2026-04-01T00:00:00.000Z"),
    },
  };
}

describe("apiKeyValidation middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateApiKey", () => {
    it("returns 401 when API key is missing", async () => {
      const req: any = {
        headers: {},
        query: {},
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized",
        message:
          "API key is required. Include it in the X-API-Key header.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 401 for invalid or expired key", async () => {
      mockApiKeyFindFirst.mockResolvedValueOnce(null);

      const req: any = {
        headers: { "x-api-key": "plain-key" },
        query: {},
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      const expectedHash = crypto
        .createHash("sha256")
        .update("plain-key")
        .digest("hex");

      expect(mockApiKeyFindFirst).toHaveBeenCalledWith({
        where: {
          keyHash: expectedHash,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        include: {
          user: {
            select: { id: true, approved: true, admin: true },
          },
        },
      });
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized",
        message: "Invalid or expired API key.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when user is not approved and not admin", async () => {
      mockApiKeyFindFirst.mockResolvedValueOnce({
        id: "key_1",
        userId: "user_1",
        tier: "HOBBY",
        user: { id: "user_1", approved: false, admin: false },
      });

      const req: any = {
        headers: { "x-api-key": "plain-key" },
        query: {},
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Forbidden",
        message: "User account is not approved for API access.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 429 and records usage when rate limit is exceeded", async () => {
      mockApiKeyFindFirst.mockResolvedValueOnce({
        id: "key_2",
        userId: "user_2",
        tier: "HOBBY",
        user: { id: "user_2", approved: true, admin: false },
      });
      mockCheckRateLimit.mockResolvedValueOnce(createRateLimitResult(false));
      mockRecordApiUsage.mockResolvedValueOnce(undefined);

      const req: any = {
        headers: { "x-api-key": "plain-key" },
        query: {},
        path: "/pubs",
        method: "GET",
        ip: "127.0.0.1",
        get: vi.fn().mockReturnValue("vitest-agent"),
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      expect(mockCheckRateLimit).toHaveBeenCalledWith("key_2", "HOBBY");
      expect(mockRecordApiUsage).toHaveBeenCalledWith(
        "key_2",
        "/pubs",
        "GET",
        429,
        expect.any(Number),
        "127.0.0.1",
        "vitest-agent"
      );
      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });

    it("sets request apiKey, headers, and tracks finish usage when allowed", async () => {
      mockApiKeyFindFirst.mockResolvedValueOnce({
        id: "key_3",
        userId: "user_3",
        tier: "DEVELOPER",
        user: { id: "user_3", approved: true, admin: false },
      });
      mockCheckRateLimit.mockResolvedValueOnce(createRateLimitResult(true));
      mockRecordApiUsage.mockResolvedValue(undefined);

      const req: any = {
        headers: { "x-api-key": "plain-key" },
        query: {},
        path: "/pubs",
        method: "GET",
        ip: "10.0.0.1",
        get: vi.fn().mockReturnValue("unit-test-agent"),
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      expect(req.apiKey).toEqual({
        id: "key_3",
        userId: "user_3",
        tier: "DEVELOPER",
        limits: {
          requestsPerHour: 1000,
          requestsPerDay: 10000,
          requestsPerMonth: 100000,
          allowLocationSearch: true,
          allowStats: true,
        },
      });
      expect(res.set).toHaveBeenCalledWith({
        "X-RateLimit-Tier": "DEVELOPER",
        "X-RateLimit-Remaining-Hour": "10",
        "X-RateLimit-Remaining-Day": "90",
        "X-RateLimit-Remaining-Month": "900",
        "X-RateLimit-Reset-Hour": "2026-03-06T11:00:00.000Z",
        "X-RateLimit-Reset-Day": "2026-03-07T00:00:00.000Z",
        "X-RateLimit-Reset-Month": "2026-04-01T00:00:00.000Z",
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));

      res.statusCode = 201;
      const finishHandler = res._listeners.get("finish");
      await finishHandler();

      expect(mockRecordApiUsage).toHaveBeenCalledWith(
        "key_3",
        "/pubs",
        "GET",
        201,
        expect.any(Number),
        "10.0.0.1",
        "unit-test-agent"
      );
    });

    it("returns 500 when an unexpected error occurs", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockApiKeyFindFirst.mockRejectedValueOnce(new Error("db down"));

      const req: any = {
        headers: { "x-api-key": "plain-key" },
        query: {},
      };
      const res = createResponse();
      const next = vi.fn();

      await validateApiKey(req, res, next);

      expect(errorSpy).toHaveBeenCalledWith(
        "API key validation error:",
        expect.any(Error)
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Internal server error",
        message: "Failed to validate API key",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requireTierAccess", () => {
    it("returns 401 when req.apiKey is missing", () => {
      const middleware = requireTierAccess("allowStats");
      const req: any = {};
      const res = createResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized",
        message: "API key validation required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when feature is unavailable for tier", () => {
      const middleware = requireTierAccess("allowLocationSearch");
      const req: any = {
        apiKey: {
          id: "key_1",
          userId: "user_1",
          tier: "HOBBY",
        },
      };
      const res = createResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Forbidden",
        message:
          "This feature is not available in your hobby tier. Please upgrade your plan.",
        tier: "HOBBY",
        availableIn: ["DEVELOPER", "BUSINESS"],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next when feature is available for tier", () => {
      const middleware = requireTierAccess("allowStats");
      const req: any = {
        apiKey: {
          id: "key_2",
          userId: "user_2",
          tier: "BUSINESS",
        },
      };
      const res = createResponse();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

});
