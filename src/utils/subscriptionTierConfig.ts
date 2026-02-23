export type SubscriptionTier = "HOBBY" | "DEVELOPER" | "BUSINESS";

export const API_KEY_LIMITS_BY_TIER: Record<
  SubscriptionTier,
  { hour: number; day: number; month: number }
> = {
  HOBBY: { hour: 100, day: 1000, month: 10000 },
  DEVELOPER: { hour: 1000, day: 10000, month: 100000 },
  BUSINESS: { hour: 5000, day: 50000, month: 500000 },
};

export const API_KEY_PERMISSIONS_BY_TIER: Record<SubscriptionTier, string[]> = {
  HOBBY: ["read:pubs"],
  DEVELOPER: ["read:pubs", "location:search"],
  BUSINESS: ["read:pubs", "write:pubs", "read:stats", "location:search"],
};
