import { describe, expect, it } from "vitest";
import { pubSchema } from "./index";

const basePubInput = {
  name: "The Test Pub",
  city: "London",
  address: "1 Test Street",
  postcode: "SW1A 1AA",
  country: "gb",
};

describe("pubSchema chainName normalization", () => {
  it("maps known aliases regardless of case and spacing", () => {
    const parsed = pubSchema.parse({
      ...basePubInput,
      chainName: "  JD    Wetherspoon  ",
    });

    expect(parsed.chainName).toBe("Wetherspoons");
  });

  it("maps Youngs aliases to Young's", () => {
    const parsed = pubSchema.parse({
      ...basePubInput,
      chainName: "youngs",
    });

    expect(parsed.chainName).toBe("Young's");
  });

  it("trims and preserves unknown chain names", () => {
    const parsed = pubSchema.parse({
      ...basePubInput,
      chainName: "  Independent    Pub  Group  ",
    });

    expect(parsed.chainName).toBe("Independent Pub Group");
  });

  it("normalizes whitespace-only chain names to undefined", () => {
    const parsed = pubSchema.parse({
      ...basePubInput,
      chainName: "    ",
    });

    expect(parsed.chainName).toBeUndefined();
  });

  it("keeps chainName undefined when omitted", () => {
    const parsed = pubSchema.parse(basePubInput);

    expect(parsed.chainName).toBeUndefined();
  });
});
