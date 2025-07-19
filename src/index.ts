import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
console.log("Prisma Client initialised");

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

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string };
}

function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
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
}

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

console.log("DATABASE_URL is:", process.env.DATABASE_URL);

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

app.post("/pubs", async (req, res) => {
  const parsed = pubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const pub = await prisma.pub.create({ data: parsed.data });
  res.status(201).json(pub);
});

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
  const user = await prisma.user.create({
    data: { name, email, approved: false },
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
  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "local" },
  });
  if (!account || !account.access_token)
    return res.status(401).json({ error: "Invalid credentials" });
  const valid = await bcrypt.compare(password, account.access_token);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign(
    { userId: user.id, email: user.email, approved: user.approved },
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

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
