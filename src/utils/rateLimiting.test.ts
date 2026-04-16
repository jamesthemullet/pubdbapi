import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockApiKeyFindUnique,
  mockApiKeyUpdate,
  mockApiKeyUsageCreate,
} = vi.hoisted(() => ({
  mockApiKeyFindUnique: vi.fn(),
  mockApiKeyUpdate: vi.fn(),
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
    expect(TIER_LIMITS.HOBBY.maxResults).toBe(10);
    expect(TIER_LIMITS.DEVELOPER.requestsPerDay).toBe(10000);
    expect(TIER_LIMITS.DEVELOPER.maxResults).toBe(100);
    expect(TIER_LIMITS.BUSINESS.requestsPerMonth).toBe(500000);
    expect(TIER_LIMITS.BUSINESS.maxResults).toBe(500);
  });

  describe("checkRateLimit", () => {
    it("denies access when api key is missing", async () => {
      mockApiKeyFindUnique.mockResolvedValueOnce(null);

      const result = await checkRateLimit("missing", "HOBBY" as any);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toEqual({ hour: 0, day: 0, month: 0 });
    });

    it("calculates remaining limits and allows request when under limits", async () => {
      // System time: 2026-03-06T10:15:30Z
      // Reset dates in future → no resets needed
      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentHourUsage: 3,
        hourlyResetDate: new Date("2026-03-06T11:00:00.000Z"),
        currentDayUsage: 20,
        dailyResetDate: new Date("2026-03-07T00:00:00.000Z"),
        currentMonthUsage: 100,
        monthlyResetDate: new Date("2026-04-01T00:00:00.000Z"),
      });

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
      const expectedNextMonthReset = new Date("2026-03-06T10:15:30.000Z");
      expectedNextMonthReset.setMonth(expectedNextMonthReset.getMonth() + 1);
      expectedNextMonthReset.setDate(1);
      expectedNextMonthReset.setHours(0, 0, 0, 0);

      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentHourUsage: 1,
        hourlyResetDate: new Date("2026-03-06T11:00:00.000Z"),
        currentDayUsage: 2,
        dailyResetDate: new Date("2026-03-07T00:00:00.000Z"),
        currentMonthUsage: 999,
        monthlyResetDate: new Date("2026-03-01T00:00:00.000Z"), // past
      });

      await checkRateLimit("key_2", "DEVELOPER" as any);

      expect(mockApiKeyUpdate).toHaveBeenCalledWith({
        where: { id: "key_2" },
        data: {
          currentMonthUsage: 0,
          monthlyResetDate: expectedNextMonthReset,
        },
      });
    });

    it("denies request when hourly limit is exhausted", async () => {
      mockApiKeyFindUnique.mockResolvedValueOnce({
        currentHourUsage: 20, // HOBBY limit maxed
        hourlyResetDate: new Date("2026-03-06T11:00:00.000Z"),
        currentDayUsage: 1,
        dailyResetDate: new Date("2026-03-07T00:00:00.000Z"),
        currentMonthUsage: 1,
        monthlyResetDate: new Date("2026-04-01T00:00:00.000Z"),
      });

      const result = await checkRateLimit("key_3", "HOBBY" as any);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toEqual({
        hour: 0,
        day: 199,
        month: 999,
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
          currentHourUsage: { increment: 1 },
          currentDayUsage: { increment: 1 },
          currentMonthUsage: { increment: 1 },
          lastUsed: expect.any(Date),
        },
      });
    });
  });
});
