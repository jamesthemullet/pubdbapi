import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockApiKeyFindUnique,
  mockApiKeyUpdate,
  mockApiKeyUsageCount,
  mockApiKeyUsageCreate,
} = vi.hoisted(() => ({
  mockApiKeyFindUnique: vi.fn(),
  mockApiKeyUpdate: vi.fn(),
  mockApiKeyUsageCount: vi.fn(),
  mockApiKeyUsageCreate: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      apiKey = {
        findUnique: mockApiKeyFindUnique,
        update: mockApiKeyUpdate,
      };
      apiKeyUsage = {
        count: mockApiKeyUsageCount,
        create: mockApiKeyUsageCreate,
      };
    },
  };
});

import { checkRateLimit, recordApiUsage, TIER_LIMITS } from "./rateLimiting";

describe("rateLimiting utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:15:30.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has expected limits for each tier", () => {
    expect(TIER_LIMITS.HOBBY.requestsPerHour).toBe(20);
    expect(TIER_LIMITS.DEVELOPER.requestsPerDay).toBe(10000);
    expect(TIER_LIMITS.BUSINESS.requestsPerMonth).toBe(500000);
  });

  describe("checkRateLimit", () => {
    it("denies access when api key is missing", async () => {
      mockApiKeyFindUnique.mockResolvedValueOnce(null);

      const result = await checkRateLimit("missing", "HOBBY" as any);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toEqual({ hour: 0, day: 0, month: 0 });
      expect(mockApiKeyUsageCount).not.toHaveBeenCalled();
    });

    it("calculates remaining limits and allows request when under limits", async () => {
      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentMonthUsage: 100,
        monthlyResetDate: new Date("2026-04-01T00:00:00.000Z"),
      });
      mockApiKeyUsageCount
        .mockResolvedValueOnce(3) // hour
        .mockResolvedValueOnce(20); // day

      const result = await checkRateLimit("key_1", "HOBBY" as any);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toEqual({
        hour: 17,
        day: 180,
        month: 900,
      });
      expect(result.resetTimes.hour.toISOString()).toBe("2026-03-06T11:00:00.000Z");
      expect(result.resetTimes.day.toISOString()).toBe("2026-03-07T00:00:00.000Z");
      expect(result.resetTimes.month.toISOString()).toBe("2026-04-01T00:00:00.000Z");
      expect(mockApiKeyUpdate).not.toHaveBeenCalled();
    });

    it("resets monthly usage when reset date has passed", async () => {
      const expectedNextReset = new Date("2026-03-06T10:15:30.000Z");
      expectedNextReset.setMonth(expectedNextReset.getMonth() + 1);
      expectedNextReset.setDate(1);
      expectedNextReset.setHours(0, 0, 0, 0);

      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentMonthUsage: 999,
        monthlyResetDate: new Date("2026-03-01T00:00:00.000Z"),
      });
      mockApiKeyUsageCount
        .mockResolvedValueOnce(1) // hour
        .mockResolvedValueOnce(2); // day

      await checkRateLimit("key_2", "DEVELOPER" as any);

      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_2" },
        data: {
          currentMonthUsage: 0,
          monthlyResetDate: expectedNextReset,
        },
      });
    });

    it("denies request when any period is exhausted", async () => {
      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentMonthUsage: 1000,
        monthlyResetDate: new Date("2026-04-01T00:00:00.000Z"),
      });
      mockApiKeyUsageCount
        .mockResolvedValueOnce(20) // hour maxed
        .mockResolvedValueOnce(199); // day still available

      const result = await checkRateLimit("key_3", "HOBBY" as any);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toEqual({
        hour: 0,
        day: 1,
        month: 0,
      });
    });
  });

  describe("recordApiUsage", () => {
    it("records usage row and increments key usage counters", async () => {
      mockApiKeyUsageCreate.mockResolvedValueOnce({ id: "usage_1" });
      mockApiKeyUpdate.mockResolvedValueOnce({ id: "key_1" });

      await recordApiUsage(
        "key_1",
        "/pubs",
        "GET",
        200,
        25,
        "127.0.0.1",
        "vitest"
      );

      expect(mockApiKeyUsageCreate).toHaveBeenCalledWith({
        data: {
          apiKeyId: "key_1",
          endpoint: "/pubs",
          method: "GET",
          statusCode: 200,
          responseTime: 25,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
      });

      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_1" },
        data: {
          usageCount: { increment: 1 },
          currentMonthUsage: { increment: 1 },
          lastUsed: expect.any(Date),
        },
      });
    });
  });
});
