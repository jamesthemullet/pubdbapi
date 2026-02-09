import { Response } from "express";
import { AuthenticatedRequest } from "../types";

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response
): req is AuthenticatedRequest & {
  user: NonNullable<AuthenticatedRequest["user"]>;
} {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}
