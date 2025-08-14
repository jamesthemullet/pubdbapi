import { Request } from "express";
import { z } from "zod";

// Extend Request interface for authenticated requests
export interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string };
}

// Common schemas
export const registerSchema = z.object({
  name: z.string().min(2),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
  email: z.string().email(),
  password: z.string().min(6),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const resetRequestSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
});

export const pubSchema = z.object({
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
