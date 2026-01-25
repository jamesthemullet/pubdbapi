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
  country: z.string().min(2),
  lat: z.number().optional(),
  lng: z.number().optional(),
  area: z.string().optional(),
  borough: z.string().optional(),
  operator: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  openingHours: z
    .record(
      z.string(),
      z.object({
        open: z.string().optional(),
        close: z.string().optional(),
        closed: z.boolean().optional(),
      })
    )
    .optional(),
});

export const beerGardenSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  seatingCapacity: z.number().int().positive().optional(),
  sunExposure: z.enum(["FULL_SUN", "PARTIAL_SUN", "SHADED"]).optional(),
  isCovered: z.boolean().optional(),
  isHeated: z.boolean().optional(),
  isFamilyFriendly: z.boolean().optional(),
  petFriendly: z.boolean().optional(),
  openingHours: z.record(z.string(), z.any()).optional(),
  imageUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const beerGardenPatchSchema = beerGardenSchema.partial().extend({
  id: z.string().optional(),
  _delete: z.boolean().optional(),
});

export const beerGardensPatchSchema = z.array(beerGardenPatchSchema).optional();
