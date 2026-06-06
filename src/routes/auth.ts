import { Router, Response } from "express";
import { ApiKeyTier, Prisma } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { addHours } from "date-fns";
import rateLimit from "express-rate-limit";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";
import { sendResetEmail } from "../utils/sendResetEmail";
import { authMiddleware } from "../middleware/auth";
import { batchCheckRateLimits, TIER_LIMITS } from "../utils/rateLimiting";
import { API_KEY_PERMISSIONS_BY_TIER } from "../utils/subscriptionTierConfig";
import {
  AuthenticatedRequest,
  registerSchema,
  loginSchema,
  resetRequestSchema,
  resetPasswordSchema,
} from "../types";
import { prisma } from "../prisma";

const router = Router();

// 5 attempts per 15 minutes per IP — protects against brute-force and credential stuffing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

// 10 requests per hour per IP — limits registration spam and API key reissue abuse
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
const DEFAULT_TIER: ApiKeyTier = "HOBBY";

router.post("/register", registrationLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { name, username, email, password } = parsed.data;

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username },
  });
  if (existingUsername) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationExpiry = addHours(new Date(), 24);

  const user = await prisma.user.create({
    data: {
      name,
      username,
      email,
      approved: false,
      verificationToken,
      verificationExpiry,
    },
  });

  await prisma.account.create({
    data: {
      userId: user.id,
      type: "credentials",
      provider: "local",
      providerAccountId: user.id,
      access_token: hashed,
    },
  });

  await sendVerificationEmail(email, verificationToken);
  res.status(201).json({ message: "User registered" });
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (!user.emailVerified) {
    return res
      .status(403)
      .json({ error: "Please verify your email before logging in" });
  }

  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "local" },
  });
  if (!account || !account.access_token) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, account.access_token);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      approved: user.approved,
      admin: user.admin,
      emailVerified: user.emailVerified,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

router.post("/forgot-password", loginLimiter, async (req, res) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return res.json({
      message: "If the email exists, a reset link has been sent",
    });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiry = addHours(new Date(), 1);

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetExpiry },
  });

  await sendResetEmail(email, resetToken);
  res.json({ message: "If the email exists, a reset link has been sent" });
});

router.post("/reset-password", loginLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { token, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      resetToken: token,
      resetExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return res.status(400).json({ error: "Reset token is invalid or expired" });
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.account.updateMany({
    where: { userId: user.id, provider: "local" },
    data: { access_token: hashed },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: null, resetExpiry: null },
  });

  res.json({ message: "Password has been reset successfully" });
});

router.post("/forgot-api-key", registrationLimiter, async (req, res) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, subscriptionTier: true },
  });

  if (!user) {
    return res.status(404).json({ error: "No account found for that email" });
  }

  const existingKeys = await prisma.apiKey.findMany({
    where: { userId: user.id, isActive: true },
    select: {
      id: true,
      tier: true,
      usageCount: true,
      currentMonthUsage: true,
      monthlyResetDate: true,
    },
  });

  const keyIds = existingKeys.map((key) => key.id);
  const aggregatedUsageCount = existingKeys.reduce(
    (sum, key) => sum + (key.usageCount || 0),
    0
  );
  const aggregatedCurrentMonthUsage = existingKeys.reduce(
    (sum, key) => sum + (key.currentMonthUsage || 0),
    0
  );

  const now = new Date();
  const defaultMonthlyReset = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1
  );
  const monthlyResetDateCandidate = existingKeys.find(
    (key) => key.monthlyResetDate && key.monthlyResetDate > now
  )?.monthlyResetDate;
  const monthlyResetDate = monthlyResetDateCandidate || defaultMonthlyReset;

  const TIER_RANK: Record<ApiKeyTier, number> = {
    HOBBY: 0,
    DEVELOPER: 1,
    BUSINESS: 2,
  };
  const existingTier = existingKeys.reduce<ApiKeyTier | null>(
    (best, key) =>
      best === null || TIER_RANK[key.tier] > TIER_RANK[best] ? key.tier : best,
    null
  );
  const tier = existingTier ?? user.subscriptionTier ?? DEFAULT_TIER;
  const tierLimits = TIER_LIMITS[tier] || TIER_LIMITS[DEFAULT_TIER];
  const permissions =
    API_KEY_PERMISSIONS_BY_TIER[tier] ||
    API_KEY_PERMISSIONS_BY_TIER[DEFAULT_TIER];

  const fullKey = `pk_${tier.toLowerCase()}_${crypto
    .randomBytes(24)
    .toString("hex")}`;
  const keyPrefix = `${fullKey.substring(0, 12)}...`;
  const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");
  const apiKey = await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const createdKey = await tx.apiKey.create({
        data: {
          name: `${tier} API Key`,
          keyHash,
          keyPrefix,
          userId: user.id,
          tier,
          keyStatus: "ACTIVE",
          requestsPerHour: tierLimits.requestsPerHour,
          requestsPerDay: tierLimits.requestsPerDay,
          requestsPerMonth: tierLimits.requestsPerMonth,
          permissions,
          monthlyResetDate,
          usageCount: aggregatedUsageCount,
          currentMonthUsage: aggregatedCurrentMonthUsage,
        },
      });

      if (keyIds.length) {
        await tx.apiKeyUsage.updateMany({
          where: { apiKeyId: { in: keyIds } },
          data: { apiKeyId: createdKey.id },
        });

        await tx.apiKey.deleteMany({
          where: { id: { in: keyIds } },
        });
      }

      return createdKey;
    }
  );

  res.json({
    message: "A new API key has been generated.",
    apiKey: {
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      tier: apiKey.tier,
      keyStatus: apiKey.keyStatus,
      permissions: apiKey.permissions,
      key: fullKey,
    },
  });
});

router.get("/verify", async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).send("Invalid or missing token.");
  }

  const user = await prisma.user.findFirst({
    where: {
      verificationToken: token,
      verificationExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return res.status(400).send("Verification link is invalid or expired.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verificationToken: null,
      verificationExpiry: null,
    },
  });

  res.send("✅ Your email has been verified. You can now log in.");
});

router.get(
  "/me",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      approved: user.approved,
      emailVerified: user.emailVerified,
    });
  }
);

router.get(
  "/dashboard",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: {
          apiKeys: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              tier: true,
              keyStatus: true,
              keyPrefix: true,
              isActive: true,
              createdAt: true,
              lastUsed: true,
              usageCount: true,
              currentMonthUsage: true,
              monthlyResetDate: true,
            },
          },
        },
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      const rateLimitMap = await batchCheckRateLimits(user.apiKeys);

      const apiKeysWithLimits = user.apiKeys.map((apiKey) => {
        const rateLimitInfo = rateLimitMap.get(apiKey.id) ?? {
          allowed: false,
          remaining: { hour: 0, day: 0, month: 0 },
          resetTimes: { hour: new Date(), day: new Date(), month: new Date() },
        };
        const tierLimits = TIER_LIMITS[apiKey.tier];

        return {
          name: apiKey.name,
          tier: apiKey.tier,
          keyStatus: apiKey.keyStatus,
          keyPrefix: apiKey.keyPrefix,
          isActive: apiKey.isActive,
          createdAt: apiKey.createdAt,
          lastUsed: apiKey.lastUsed,
          usageCount: apiKey.usageCount,
          remaining: rateLimitInfo.remaining,
          limits: {
            requestsPerHour: tierLimits.requestsPerHour,
            requestsPerDay: tierLimits.requestsPerDay,
            requestsPerMonth: tierLimits.requestsPerMonth,
          },
          resetTimes: rateLimitInfo.resetTimes,
          features: {
            allowLocationSearch: tierLimits.allowLocationSearch,
            allowStats: tierLimits.allowStats,
          },
        };
      });

      res.json({
        user: {
          name: user.name,
          username: user.username,
          email: user.email,
          approved: user.approved,
          emailVerified: user.emailVerified,
        },
        apiKeys: apiKeysWithLimits,
        summary: {
          totalApiKeys: apiKeysWithLimits.length,
          totalUsage: apiKeysWithLimits.reduce(
            (sum, key) => sum + (key.usageCount || 0),
            0
          ),
        },
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to load dashboard data",
      });
    }
  }
);

const ADDRESS_FIELDS = new Set([
  "address",
  "postcode",
  "city",
  "country",
  "lat",
  "lng",
  "area",
  "borough",
]);
const FEATURE_FIELDS = new Set([
  "hasFood",
  "hasSundayRoast",
  "hasBeerGarden",
  "hasCaskAle",
  "isBeerFocused",
  "isDogFriendly",
  "isFamilyFriendly",
  "hasStepFreeAccess",
  "hasAccessibleToilet",
  "hasLiveSport",
  "hasLiveMusic",
]);
const DETAIL_FIELDS = new Set([
  "name",
  "description",
  "website",
  "phone",
  "chainName",
  "operator",
  "isIndependent",
  "imageUrl",
]);

export const categorizeEditTypes = (
  newValues: Record<string, unknown>
): string[] => {
  const types = new Set<string>();
  for (const key of Object.keys(newValues)) {
    if (ADDRESS_FIELDS.has(key)) types.add("address");
    else if (FEATURE_FIELDS.has(key)) types.add("features");
    else if (DETAIL_FIELDS.has(key)) types.add("details");
    else if (key === "beerTypes") types.add("beer types");
    else if (key === "beerGardens") types.add("beer garden");
    else if (key === "openingHours") types.add("opening hours");
  }
  return [...types];
};

router.get(
  "/contributions",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const userId = req.user.userId;

      const [totalAdded, recentPubs, totalEdited, recentAuditLogs] =
        await Promise.all([
          prisma.pub.count({ where: { createdById: userId } }),
          prisma.pub.findMany({
            where: { createdById: userId },
            select: { id: true, name: true, city: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          prisma.auditLog.count({
            where: { action: "UPDATE", entity: "Pub", userId },
          }),
          prisma.auditLog.findMany({
            where: { action: "UPDATE", entity: "Pub", userId },
            orderBy: { timestamp: "desc" },
            take: 10,
          }),
        ]);

      const pubIds = [...new Set(recentAuditLogs.map((log) => log.entityId))];
      const editedPubs = pubIds.length
        ? await prisma.pub.findMany({
            where: { id: { in: pubIds } },
            select: { id: true, name: true, city: true },
          })
        : [];
      const pubMap = new Map(editedPubs.map((p) => [p.id, p]));

      const recentEdits = recentAuditLogs.map((log) => ({
        pubId: log.entityId,
        pubName: pubMap.get(log.entityId)?.name ?? null,
        city: pubMap.get(log.entityId)?.city ?? null,
        timestamp: log.timestamp,
        editTypes: categorizeEditTypes(
          (log.newValues as Record<string, unknown>) ?? {}
        ),
      }));

      res.json({ totalAdded, recentPubs, totalEdited, recentEdits });
    } catch (error) {
      console.error("Contributions error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to load contributions",
      });
    }
  }
);

export default router;
