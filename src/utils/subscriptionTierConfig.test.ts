import { describe, expect, it } from "vitest";
import {
  API_KEY_LIMITS_BY_TIER,
  API_KEY_PERMISSIONS_BY_TIER,
} from "./subscriptionTierConfig";

describe("subscriptionTierConfig", () => {
  it("defines expected request limits by tier", () => {
    expect(API_KEY_LIMITS_BY_TIER.HOBBY).toEqual({
      hour: 100,
      day: 1000,
      month: 10000,
    });
    expect(API_KEY_LIMITS_BY_TIER.DEVELOPER.hour).toBeGreaterThan(
      API_KEY_LIMITS_BY_TIER.HOBBY.hour
    );
    expect(API_KEY_LIMITS_BY_TIER.BUSINESS.day).toBeGreaterThan(
      API_KEY_LIMITS_BY_TIER.DEVELOPER.day
    );
  });

  it("defines expected permissions by tier", () => {
    expect(API_KEY_PERMISSIONS_BY_TIER.HOBBY).toEqual(["read:pubs"]);
    expect(API_KEY_PERMISSIONS_BY_TIER.DEVELOPER).toContain("location:search");
    expect(API_KEY_PERMISSIONS_BY_TIER.BUSINESS).toContain("write:pubs");
    expect(API_KEY_PERMISSIONS_BY_TIER.BUSINESS).toContain("read:stats");
  });
});
