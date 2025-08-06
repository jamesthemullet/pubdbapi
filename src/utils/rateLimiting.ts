import { PrismaClient, ApiKeyTier } from "@prisma/client";

const prisma = new PrismaClient();

export interface TierLimits {
  requestsPerHour: number;
  requestsPerDay: number;
  requestsPerMonth: number;
  maxResultsPerRequest: number;
  allowLocationSearch: boolean;
  allowStats: boolean;
}

export const TIER_LIMITS: Record<ApiKeyTier, TierLimits> = {
  TESTING: {
    requestsPerHour: 20,
    requestsPerDay: 200,
    requestsPerMonth: 1000,
    maxResultsPerRequest: 10,
    allowLocationSearch: false,
    allowStats: false,
  },
  DEVELOPER: {
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    requestsPerMonth: 100000,
    maxResultsPerRequest: 100,
    allowLocationSearch: true,
    allowStats: true,
  },
  BUSINESS: {
    requestsPerHour: 5000,
    requestsPerDay: 50000,
    requestsPerMonth: 500000,
    maxResultsPerRequest: 500,
    allowLocationSearch: true,
    allowStats: true,
  },
};

export async function checkRateLimit(
  apiKeyId: string,
  tier: ApiKeyTier
): Promise<{
  allowed: boolean;
  remaining: { hour: number; day: number; month: number };
  resetTimes: { hour: Date; day: Date; month: Date };
}> {
  const limits = TIER_LIMITS[tier];
  const now = new Date();

  // Get current API key data
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      currentMonthUsage: true,
      monthlyResetDate: true,
    },
  });

  if (!apiKey) {
    return {
      allowed: false,
      remaining: { hour: 0, day: 0, month: 0 },
      resetTimes: { hour: now, day: now, month: now },
    };
  }

  // Check if we need to reset monthly usage
  const monthlyResetNeeded = now > apiKey.monthlyResetDate;

  if (monthlyResetNeeded) {
    const nextReset = new Date(now);
    nextReset.setMonth(nextReset.getMonth() + 1);
    nextReset.setDate(1);
    nextReset.setHours(0, 0, 0, 0);

    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        currentMonthUsage: 0,
        monthlyResetDate: nextReset,
      },
    });
  }

  // Calculate time windows
  const hourStart = new Date(now);
  hourStart.setMinutes(0);
  hourStart.setSeconds(0);
  hourStart.setMilliseconds(0);

  const dayStart = new Date(now);
  dayStart.setHours(0);
  dayStart.setMinutes(0);
  dayStart.setSeconds(0);
  dayStart.setMilliseconds(0);

  // Get usage counts for different time periods using ApiKeyUsage table
  const [hourlyUsage, dailyUsage] = await Promise.all([
    prisma.apiKeyUsage.count({
      where: {
        apiKeyId: apiKeyId,
        timestamp: { gte: hourStart },
      },
    }),
    prisma.apiKeyUsage.count({
      where: {
        apiKeyId: apiKeyId,
        timestamp: { gte: dayStart },
      },
    }),
  ]);

  const currentMonthUsage = monthlyResetNeeded ? 0 : apiKey.currentMonthUsage;

  const remaining = {
    hour: Math.max(0, limits.requestsPerHour - hourlyUsage),
    day: Math.max(0, limits.requestsPerDay - dailyUsage),
    month: Math.max(0, limits.requestsPerMonth - currentMonthUsage),
  };

  const allowed =
    remaining.hour > 0 && remaining.day > 0 && remaining.month > 0;

  const resetTimes = {
    hour: new Date(hourStart.getTime() + 60 * 60 * 1000),
    day: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
    month: apiKey.monthlyResetDate,
  };

  return { allowed, remaining, resetTimes };
}

export async function recordApiUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTime?: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await Promise.all([
    // Record detailed usage
    prisma.apiKeyUsage.create({
      data: {
        apiKeyId,
        endpoint,
        method,
        statusCode,
        responseTime,
        ipAddress,
        userAgent,
      },
    }),
    // Update API key counters
    prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        usageCount: { increment: 1 },
        currentMonthUsage: { increment: 1 },
        lastUsed: new Date(),
      },
    }),
  ]);
}
