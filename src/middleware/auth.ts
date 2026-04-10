import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthenticatedRequest } from "../types";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");

export const authMiddleware = (
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
      const { userId, email } = payload as { userId: string; email: string };
      req.user = { userId, email };
      next();
    } else {
      return res.status(401).json({ error: "Invalid token payload" });
    }
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

export const adminMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const { prisma } = await import("../server.js");
  const currentUser = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { admin: true },
  });

  if (!currentUser || !currentUser.admin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
};
