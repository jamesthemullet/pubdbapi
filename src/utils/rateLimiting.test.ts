import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
  mockApiKeyFindUnique,
  mockApiKeyUpdate,
  mockApiKeyUpdateMany,
  mockApiKeyUsageCreate,
  mockApiKeyUsageGroupBy,
} = vi.hoisted(() => ({
  mockApiKeyFindUnique: vi.fn(),
  mockApiKeyUpdate: vi.fn(),
  mockApiKeyUpdateMany: vi.fn(),
  mockApiKeyUsageCreate: vi.fn(),
  mockApiKeyUsageGroupBy: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      apiKey = {
        findUnique: mockApiKeyFindUnique,
        update: mockApiKeyUpdate,
        updateMany: mockApiKeyUpdateMany,
      };
      apiKeyUsage = {
        create: mockApiKeyUsageCreate,
        groupBy: mockApiKeyUsageGroupBy,
      };
    },
  };
});

import { checkRateLimit, batchCheckRateLimits, recordApiUsage, TIER_LIMITS } from "./rateLimiting";

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

  describe("batchCheckRateLimits", () => {
    beforeEach(() => {
      mockApiKeyUsageGroupBy.mockReset();
      mockApiKeyUpdateMany.mockReset();
    });

    it("returns empty map when given no keys", async () => {
      const result = await batchCheckRateLimits([]);
      expect(result.size).toBe(0);
      expect(mockApiKeyUsageGroupBy).not.toHaveBeenCalled();
    });

    it("computes remaining limits from usage counts", async () => {
      mockApiKeyUsageGroupBy
        .mockResolvedValueOnce([{ apiKeyId: "key_1", _count: { apiKeyId: 5 } }])  // hourly
        .mockResolvedValueOnce([{ apiKeyId: "key_1", _count: { apiKeyId: 15 } }]); // daily

      const futureReset = new Date("2026-04-01T00:00:00.000Z");
      const result = await batchCheckRateLimits([
        { id: "key_1", tier: "HOBBY" as any, currentMonthUsage: 10, monthlyResetDate: futureReset },
      ]);

      const entry = result.get("key_1")!;
      expect(entry.allowed).toBe(true);
      expect(entry.remaining.hour).toBe(15); // 20 - 5
      expect(entry.remaining.day).toBe(185); // 200 - 15
      expect(entry.remaining.month).toBe(990); // 1000 - 10
    });

    it("denies when hourly limit is exhausted", async () => {
      mockApiKeyUsageGroupBy
        .mockResolvedValueOnce([{ apiKeyId: "key_2", _count: { apiKeyId: 20 } }]) // hourly maxed
        .mockResolvedValueOnce([]);

      const futureReset = new Date("2026-04-01T00:00:00.000Z");
      const result = await batchCheckRateLimits([
        { id: "key_2", tier: "HOBBY" as any, currentMonthUsage: 0, monthlyResetDate: futureReset },
      ]);

      expect(result.get("key_2")!.allowed).toBe(false);
      expect(result.get("key_2")!.remaining.hour).toBe(0);
    });

    it("resets monthly usage for keys whose reset date has passed", async () => {
      mockApiKeyUsageGroupBy.mockResolvedValue([]);
      mockApiKeyUpdateMany.mockResolvedValue({ count: 1 });

      const pastReset = new Date("2026-03-01T00:00:00.000Z"); // before 2026-03-06 system time
      const result = await batchCheckRateLimits([
        { id: "key_3", tier: "DEVELOPER" as any, currentMonthUsage: 500, monthlyResetDate: pastReset },
      ]);

      expect(mockApiKeyUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["key_3"] } },
          data: expect.objectContaining({ currentMonthUsage: 0 }),
        })
      );
      // After reset, month usage treated as 0
      expect(result.get("key_3")!.remaining.month).toBe(100000);
    });

    it("uses 0 for keys absent from usage counts", async () => {
      mockApiKeyUsageGroupBy.mockResolvedValue([]); // no records for this key

      const futureReset = new Date("2026-04-01T00:00:00.000Z");
      const result = await batchCheckRateLimits([
        { id: "key_4", tier: "BUSINESS" as any, currentMonthUsage: 0, monthlyResetDate: futureReset },
      ]);

      const entry = result.get("key_4")!;
      expect(entry.remaining.hour).toBe(5000);
      expect(entry.remaining.day).toBe(50000);
      expect(entry.remaining.month).toBe(500000);
      expect(entry.allowed).toBe(true);
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
