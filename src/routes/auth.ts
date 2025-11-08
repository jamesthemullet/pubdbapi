import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { addHours } from "date-fns";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";
import { sendResetEmail } from "../utils/sendResetEmail";
import { authMiddleware } from "../middleware/auth";
import { checkRateLimit, TIER_LIMITS } from "../utils/rateLimiting";
import {
  AuthenticatedRequest,
  registerSchema,
  loginSchema,
  resetRequestSchema,
  resetPasswordSchema,
} from "../types";
import { prisma } from "../server";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

router.post("/register", async (req, res) => {
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

router.post("/login", async (req, res) => {
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

router.post("/logout", authMiddleware, async (req, res) => {
  res.json({ message: "Logged out" });
});

router.post("/forgot-password", async (req, res) => {
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

router.post("/reset-password", async (req, res) => {
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
              name: true,
              tier: true,
              keyStatus: true,
              keyPrefix: true,
              isActive: true,
              createdAt: true,
              lastUsed: true,
              usageCount: true,
            },
          },
        },
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      const apiKeysWithLimits = await Promise.all(
        user.apiKeys.map(async (apiKey) => {
          const fullApiKey = await prisma.apiKey.findFirst({
            where: {
              keyPrefix: apiKey.keyPrefix,
              userId: user.id,
              isActive: true,
            },
          });

          if (!fullApiKey) {
            return {
              ...apiKey,
              remaining: { hour: 0, day: 0, month: 0 },
              limits: {
                requestsPerHour: 0,
                requestsPerDay: 0,
                requestsPerMonth: 0,
              },
              resetTimes: {
                hour: new Date(),
                day: new Date(),
                month: new Date(),
              },
            };
          }

          const rateLimitInfo = await checkRateLimit(
            fullApiKey.id,
            fullApiKey.tier
          );
          const tierLimits = TIER_LIMITS[fullApiKey.tier];

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
        })
      );

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

export default router;
