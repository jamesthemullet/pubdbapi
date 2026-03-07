import { describe, expect, it } from "vitest";
import { ISO_COUNTRY_CODES } from "./countryCodes";

describe("ISO_COUNTRY_CODES", () => {
  it("contains common country codes and excludes invalid ones", () => {
    expect(ISO_COUNTRY_CODES.has("GB")).toBe(true);
    expect(ISO_COUNTRY_CODES.has("US")).toBe(true);
    expect(ISO_COUNTRY_CODES.has("ZZ")).toBe(false);
  });

  it("stores uppercase two-letter codes", () => {
    for (const code of ISO_COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});
