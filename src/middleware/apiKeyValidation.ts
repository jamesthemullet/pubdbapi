import { Request, Response, NextFunction } from "express";
import { PrismaClient, ApiKeyTier } from "@prisma/client";
import {
  checkRateLimit,
  recordApiUsage,
  TIER_LIMITS,
  TierLimits,
} from "../utils/rateLimiting";
import crypto from "crypto";

const prisma = new PrismaClient();

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    userId: string;
    tier: ApiKeyTier;
    limits: TierLimits;
  };
}

export const validateApiKey = async (
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();

  try {
    const apiKeyValue = req.headers["x-api-key"] || req.query.api_key;

    if (!apiKeyValue) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message:
          "API key is required. Include it in the X-API-Key header or api_key query parameter.",
      });
    }

    // Hash the API key to compare with stored hash
    const hashedKey = crypto
      .createHash("sha256")
      .update(apiKeyValue as string)
      .digest("hex");

    // Find the API key in database
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        keyHash: hashedKey,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        user: {
          select: { id: true, approved: true, admin: true },
        },
      },
    });

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Invalid or expired API key.",
      });
    }

    // Check if user is still approved
    if (!apiKey.user.approved && !apiKey.user.admin) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: "User account is not approved for API access.",
      });
    }

    // Check rate limits
    const rateLimitResult = await checkRateLimit(apiKey.id, apiKey.tier);

    if (!rateLimitResult.allowed) {
      // Still record the usage attempt for analytics
      await recordApiUsage(
        apiKey.id,
        req.path,
        req.method,
        429,
        Date.now() - startTime,
        req.ip,
        req.get("User-Agent")
      );

      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        message: "API rate limit exceeded. Please try again later.",
        rateLimits: {
          tier: apiKey.tier,
          remaining: rateLimitResult.remaining,
          resetTimes: rateLimitResult.resetTimes,
        },
      });
    }

    // Add API key info to request
    req.apiKey = {
      id: apiKey.id,
      userId: apiKey.userId,
      tier: apiKey.tier,
      limits: TIER_LIMITS[apiKey.tier],
    };

    // Add rate limit headers
    res.set({
      "X-RateLimit-Tier": apiKey.tier,
      "X-RateLimit-Remaining-Hour": rateLimitResult.remaining.hour.toString(),
      "X-RateLimit-Remaining-Day": rateLimitResult.remaining.day.toString(),
      "X-RateLimit-Remaining-Month": rateLimitResult.remaining.month.toString(),
      "X-RateLimit-Reset-Hour": rateLimitResult.resetTimes.hour.toISOString(),
      "X-RateLimit-Reset-Day": rateLimitResult.resetTimes.day.toISOString(),
      "X-RateLimit-Reset-Month": rateLimitResult.resetTimes.month.toISOString(),
    });

    // Record successful authentication for later usage tracking
    res.on("finish", () => {
      recordApiUsage(
        apiKey.id,
        req.path,
        req.method,
        res.statusCode,
        Date.now() - startTime,
        req.ip,
        req.get("User-Agent")
      ).catch(console.error);
    });

    next();
  } catch (error) {
    console.error("API key validation error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to validate API key",
    });
  }
};

// Middleware to check if endpoint is allowed for tier
export const requireTierAccess = (requiredFeature: keyof TierLimits) => {
  return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "API key validation required",
      });
    }

    const limits = TIER_LIMITS[req.apiKey.tier];

    if (!limits[requiredFeature]) {
      return res.status(403).json({
        success: false,
        error: "Forbidden",
        message: `This feature is not available in your ${req.apiKey.tier.toLowerCase()} tier. Please upgrade your plan.`,
        tier: req.apiKey.tier,
        availableIn: Object.keys(TIER_LIMITS).filter(
          (tier) => TIER_LIMITS[tier as ApiKeyTier][requiredFeature]
        ),
      });
    }

    next();
  };
};

// Middleware to enforce result limits based on tier
export const enforceTierLimits = (
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.apiKey) {
    return next();
  }

  next();
};
