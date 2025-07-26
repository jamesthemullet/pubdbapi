import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { addHours } from "date-fns";
import { sendVerificationEmail } from "./utils/sendVerificationEmail";
import { sendResetEmail } from "./utils/sendResetEmail";
import {
  createAuditLog,
  getClientInfo,
  getChangedFields,
} from "./utils/auditLog";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

import { z } from "zod";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
});

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string };
}

const authMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing token" });
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "userId" in payload &&
      "email" in payload
    ) {
      req.user = {
        userId: (payload as any).userId,
        email: (payload as any).email,
      };
      next();
    } else {
      return res.status(401).json({ error: "Invalid token payload" });
    }
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const pubSchema = z.object({
  name: z.string().min(2),
  city: z.string(),
  address: z.string(),
  postcode: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  tags: z.array(z.string()),
  website: z.string().url().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get("/pubs", async (req, res) => {
  const { city, tag, name } = req.query;
  let where: any = {};

  if (city) {
    where.city = { equals: String(city), mode: "insensitive" };
  }

  if (tag) {
    where.tags = { has: String(tag) };
  }

  if (name) {
    where.name = {
      contains: String(name),
      mode: "insensitive",
    };
  }

  const pubs = await prisma.pub.findMany({ where });
  res.json(pubs);
});

app.get("/pubs/:id", async (req, res) => {
  const { id } = req.params;
  const pub = await prisma.pub.findUnique({ where: { id } });
  if (!pub) return res.status(404).json({ message: "Pub not found" });
  res.json(pub);
});

app.post(
  "/pubs",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = pubSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const existing = await prisma.pub.findFirst({
      where: {
        name: { equals: parsed.data.name, mode: "insensitive" },
        OR: [
          { address: { equals: parsed.data.address, mode: "insensitive" } },
          { postcode: parsed.data.postcode },
        ],
      },
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "Pub with this name already exists at this location" });
    }

    const pub = await prisma.pub.create({ data: parsed.data });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "CREATE",
      entity: "Pub",
      entityId: pub.id,
      userId: req.user.userId,
      newValues: pub,
      ...clientInfo,
    });

    res.status(201).json(pub);
  }
);

app.patch(
  "/pubs/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { id } = req.params;
    const partialPubSchema = pubSchema.partial();
    const parsed = partialPubSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      const updatedPub = await prisma.pub.update({
        where: { id },
        data: parsed.data,
      });

      const { oldValues, newValues } = getChangedFields(
        originalPub,
        updatedPub
      );
      const clientInfo = getClientInfo(req);

      await createAuditLog({
        action: "UPDATE",
        entity: "Pub",
        entityId: id,
        userId: req.user.userId,
        oldValues,
        newValues,
        ...clientInfo,
      });

      res.json(updatedPub);
    } catch (err) {
      return res.status(404).json({ error: "Pub not found or update failed" });
    }
  }
);

app.delete(
  "/pubs/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true, approved: true },
    });

    if (!currentUser || (!currentUser.admin && !currentUser.approved)) {
      return res
        .status(403)
        .json({ error: "Admin or approved user access required" });
    }

    const { id } = req.params;

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      await prisma.pub.delete({
        where: { id },
      });

      const clientInfo = getClientInfo(req);
      await createAuditLog({
        action: "DELETE",
        entity: "Pub",
        entityId: id,
        userId: req.user.userId,
        oldValues: originalPub,
        ...clientInfo,
      });

      res.json({ message: "Pub deleted successfully" });
    } catch (err) {
      return res.status(404).json({ error: "Pub not found" });
    }
  }
);

app.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    return res.status(409).json({ error: "Email already registered" });

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

app.post("/login", async (req, res) => {
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
  if (!account || !account.access_token)
    return res.status(401).json({ error: "Invalid credentials" });
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
    {
      expiresIn: "7d",
    }
  );
  res.json({ token });
});

app.post("/logout", authMiddleware, async (req, res) => {
  res.json({ message: "Logged out" });
});

app.post("/forgot-password", async (req, res) => {
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
  const resetExpiry = addHours(new Date(), 1); // 1 hour expiry

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken,
      resetExpiry,
    },
  });

  await sendResetEmail(email, resetToken);

  res.json({ message: "If the email exists, a reset link has been sent" });
});

app.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const { token, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      resetToken: token,
      resetExpiry: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    return res.status(400).json({ error: "Reset token is invalid or expired" });
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.account.updateMany({
    where: {
      userId: user.id,
      provider: "local",
    },
    data: {
      access_token: hashed,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: null,
      resetExpiry: null,
    },
  });

  res.json({ message: "Password has been reset successfully" });
});

app.get("/verify", async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).send("Invalid or missing token.");
  }

  const user = await prisma.user.findFirst({
    where: {
      verificationToken: token,
      verificationExpiry: {
        gt: new Date(),
      },
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

app.get(
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

app.get(
  "/users",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, admin: true },
    });
    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        approved: true,
        admin: true,
      },
    });
    res.json(users);
  }
);

// Get audit logs (admin only)
app.get(
  "/audit-logs",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });
    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { entity, action, entityId, limit = "50" } = req.query;

    const where: any = {};
    if (entity) where.entity = String(entity);
    if (action) where.action = String(action);
    if (entityId) where.entityId = String(entityId);

    const auditLogs = await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
      orderBy: { timestamp: "desc" },
      take: parseInt(String(limit)),
    });

    res.json(auditLogs);
  }
);
