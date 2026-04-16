import { ApiKeyTier } from "@prisma/client";

import { prisma } from "../prisma";

export interface TierLimits {
  requestsPerHour: number;
  requestsPerDay: number;
  requestsPerMonth: number;
  allowLocationSearch: boolean;
  allowStats: boolean;
}

export const TIER_LIMITS: Record<ApiKeyTier, TierLimits> = {
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

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      currentHourUsage: true,
      hourlyResetDate: true,
      currentDayUsage: true,
      dailyResetDate: true,
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

  const hourlyResetNeeded = now >= apiKey.hourlyResetDate;
  const dailyResetNeeded = now >= apiKey.dailyResetDate;
  const monthlyResetNeeded = now > apiKey.monthlyResetDate;

  // Build next reset timestamps
  const nextHourReset = new Date(now);
  nextHourReset.setMinutes(0, 0, 0);
  nextHourReset.setHours(nextHourReset.getHours() + 1);

  const nextDayReset = new Date(now);
  nextDayReset.setHours(0, 0, 0, 0);
  nextDayReset.setDate(nextDayReset.getDate() + 1);

  const nextMonthReset = new Date(now);
  nextMonthReset.setMonth(nextMonthReset.getMonth() + 1);
  nextMonthReset.setDate(1);
  nextMonthReset.setHours(0, 0, 0, 0);

  // Reset any expired windows in a single update if needed
  if (hourlyResetNeeded || dailyResetNeeded || monthlyResetNeeded) {
    const resetData: Record<string, number | Date> = {};
    if (hourlyResetNeeded) {
      resetData.currentHourUsage = 0;
      resetData.hourlyResetDate = nextHourReset;
    }
    if (dailyResetNeeded) {
      resetData.currentDayUsage = 0;
      resetData.dailyResetDate = nextDayReset;
    }
    if (monthlyResetNeeded) {
      resetData.currentMonthUsage = 0;
      resetData.monthlyResetDate = nextMonthReset;
    }
    await prisma.apiKey.update({ where: { id: apiKeyId }, data: resetData });
  }

  const currentHourUsage = hourlyResetNeeded ? 0 : apiKey.currentHourUsage;
  const currentDayUsage = dailyResetNeeded ? 0 : apiKey.currentDayUsage;
  const currentMonthUsage = monthlyResetNeeded ? 0 : apiKey.currentMonthUsage;

  const remaining = {
    hour: Math.max(0, limits.requestsPerHour - currentHourUsage),
    day: Math.max(0, limits.requestsPerDay - currentDayUsage),
    month: Math.max(0, limits.requestsPerMonth - currentMonthUsage),
  };

  const allowed =
    remaining.hour > 0 && remaining.day > 0 && remaining.month > 0;

  const resetTimes = {
    hour: hourlyResetNeeded ? nextHourReset : apiKey.hourlyResetDate,
    day: dailyResetNeeded ? nextDayReset : apiKey.dailyResetDate,
    month: monthlyResetNeeded ? nextMonthReset : apiKey.monthlyResetDate,
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

    prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        usageCount: { increment: 1 },
        currentHourUsage: { increment: 1 },
        currentDayUsage: { increment: 1 },
        currentMonthUsage: { increment: 1 },
        lastUsed: new Date(),
      },
    }),
  ]);
}
