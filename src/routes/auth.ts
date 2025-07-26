import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { addHours } from "date-fns";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";
import { sendResetEmail } from "../utils/sendResetEmail";
import { authMiddleware } from "../middleware/auth";
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

// Register
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationExpiry = addHours(new Date(), 24);

  const user = await prisma.user.create({
    data: {
      name,
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

// Login
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

// Logout
router.post("/logout", authMiddleware, async (req, res) => {
  res.json({ message: "Logged out" });
});

// Forgot password
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

// Reset password
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

// Verify email
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

// Get current user
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
      email: user.email,
      approved: user.approved,
      emailVerified: user.emailVerified,
    });
  }
);

export default router;
