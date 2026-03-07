import { Request } from "express";
import { z } from "zod";
import { ISO_COUNTRY_CODES } from "../utils/countryCodes";

const CHAIN_NAME_ALIASES: Record<string, string> = {
  "jd wetherspoon": "Wetherspoons",
  wetherspoon: "Wetherspoons",
  wetherspoons: "Wetherspoons",
  youngs: "Young's",
  "young's": "Young's",
};

const normalizeChainName = (value?: string) => {
  if (!value) return value;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase();
  return CHAIN_NAME_ALIASES[key] ?? trimmed;
};

// Extend Request interface for authenticated requests
export interface AuthenticatedRequest<
  P extends Record<string, string> = Record<string, string>
> extends Request<P> {
  user?: { userId: string; email: string };
}

// Common schemas
export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
  email: z.string().email().max(320),
  password: z.string().min(6).max(128),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(6).max(128),
});

export const resetRequestSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().max(255),
  password: z.string().min(6).max(128),
});

export const pubSchema = z.object({
  name: z.string().min(2).max(150),
  city: z.string().max(100),
  address: z.string().max(255),
  postcode: z.string().max(20),
  country: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .refine((value) => ISO_COUNTRY_CODES.has(value), {
      message: "Invalid country code",
    }),
  lat: z.number().optional(),
  lng: z.number().optional(),
  area: z.string().max(100).optional(),
  borough: z.string().max(100).optional(),
  operator: z.string().max(150).optional(),
  phone: z.string().max(30).optional(),
  website: z.string().url().max(2048).optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  chainName: z
    .string()
    .min(1)
    .max(150)
    .optional()
    .transform((value) => normalizeChainName(value)),
  isIndependent: z.boolean().optional(),
  hasFood: z.boolean().optional(),
  hasSundayRoast: z.boolean().optional(),
  hasBeerGarden: z.boolean().optional(),
  hasCaskAle: z.boolean().optional(),
  isBeerFocused: z.boolean().optional(),
  isDogFriendly: z.boolean().optional(),
  isFamilyFriendly: z.boolean().optional(),
  hasStepFreeAccess: z.boolean().optional(),
  hasAccessibleToilet: z.boolean().optional(),
  hasLiveSport: z.boolean().optional(),
  hasLiveMusic: z.boolean().optional(),
  openingHours: z
    .record(
      z.string().max(20),
      z.object({
        open: z.string().max(20).optional(),
        close: z.string().max(20).optional(),
        closed: z.boolean().optional(),
      })
    )
    .optional(),
});

export const beerGardenSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  seatingCapacity: z.number().int().positive().optional(),
  sunExposure: z.enum(["FULL_SUN", "PARTIAL_SUN", "SHADED"]).optional(),
  isCovered: z.boolean().optional(),
  isHeated: z.boolean().optional(),
  isFamilyFriendly: z.boolean().optional(),
  petFriendly: z.boolean().optional(),
  openingHours: z.record(z.string().max(20), z.any()).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(1000).optional(),
});

export const beerGardenPatchSchema = beerGardenSchema.partial().extend({
  id: z.string().max(50).optional(),
  _delete: z.boolean().optional(),
});

export const beerGardensPatchSchema = z.array(beerGardenPatchSchema).optional();

export const pubBeerTypeSchema = z.object({
  beerTypeId: z.string().min(1).max(50),
});

export const pubBeerTypePatchSchema = pubBeerTypeSchema.extend({
  _delete: z.boolean().optional(),
});

export const pubBeerTypesPatchSchema = z
  .array(pubBeerTypePatchSchema)
  .optional();
