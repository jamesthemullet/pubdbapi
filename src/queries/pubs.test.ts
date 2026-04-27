import { describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({
  prisma: {},
}));

import { buildPubWhereClause, parsePagination, PUB_AMENITY_FIELDS } from "./pubs";

describe("buildPubWhereClause", () => {
  describe("search", () => {
    it("adds an OR clause across name, area, borough, city, and operator", () => {
      const where = buildPubWhereClause({ search: "green" });

      expect(where.OR).toEqual([
        { name: { contains: "green", mode: "insensitive" } },
        { area: { contains: "green", mode: "insensitive" } },
        { borough: { contains: "green", mode: "insensitive" } },
        { city: { contains: "green", mode: "insensitive" } },
        { operator: { contains: "green", mode: "insensitive" } },
      ]);
    });

    it("does not add OR when search is undefined", () => {
      const where = buildPubWhereClause({});
      expect(where.OR).toBeUndefined();
    });

    it("does not add OR when search is empty string", () => {
      const where = buildPubWhereClause({ search: "" });
      expect(where.OR).toBeUndefined();
    });

    it("can be combined with other filters", () => {
      const where = buildPubWhereClause({ search: "green", country: "GB" });

      expect(where.OR).toBeDefined();
      expect(where.country).toEqual({ equals: "GB", mode: "insensitive" });
    });
  });

  describe("individual filters", () => {
    it("applies city as exact insensitive match", () => {
      const where = buildPubWhereClause({ city: "London" });
      expect(where.city).toEqual({ equals: "London", mode: "insensitive" });
    });

    it("applies name as contains insensitive match", () => {
      const where = buildPubWhereClause({ name: "crown" });
      expect(where.name).toEqual({ contains: "crown", mode: "insensitive" });
    });

    it("applies operator as contains insensitive match", () => {
      const where = buildPubWhereClause({ operator: "stonegate" });
      expect(where.operator).toEqual({
        contains: "stonegate",
        mode: "insensitive",
      });
    });

    it("applies borough as contains insensitive match", () => {
      const where = buildPubWhereClause({ borough: "camden" });
      expect(where.borough).toEqual({
        contains: "camden",
        mode: "insensitive",
      });
    });

    it("applies postcode as exact insensitive match", () => {
      const where = buildPubWhereClause({ postcode: "NW1 6XE" });
      expect(where.postcode).toEqual({
        equals: "NW1 6XE",
        mode: "insensitive",
      });
    });

    it("applies area as exact insensitive match", () => {
      const where = buildPubWhereClause({ area: "East" });
      expect(where.area).toEqual({ equals: "East", mode: "insensitive" });
    });

    it("applies country as exact insensitive match", () => {
      const where = buildPubWhereClause({ country: "GB" });
      expect(where.country).toEqual({ equals: "GB", mode: "insensitive" });
    });

    it("returns empty object when no filters supplied", () => {
      const where = buildPubWhereClause({});
      expect(where).toEqual({});
    });
  });

  describe("amenity filters", () => {
    it("applies a true boolean amenity filter", () => {
      const where = buildPubWhereClause({ amenities: { hasFood: true } });
      expect(where.hasFood).toBe(true);
    });

    it("applies a false boolean amenity filter", () => {
      const where = buildPubWhereClause({ amenities: { isDogFriendly: false } });
      expect(where.isDogFriendly).toBe(false);
    });

    it("applies multiple amenity filters", () => {
      const where = buildPubWhereClause({
        amenities: { hasBeerGarden: true, hasLiveMusic: false },
      });
      expect(where.hasBeerGarden).toBe(true);
      expect(where.hasLiveMusic).toBe(false);
    });

    it("can be combined with other filters", () => {
      const where = buildPubWhereClause({ city: "London", amenities: { hasCaskAle: true } });
      expect(where.city).toEqual({ equals: "London", mode: "insensitive" });
      expect(where.hasCaskAle).toBe(true);
    });

    it("ignores amenities when object is empty", () => {
      const where = buildPubWhereClause({ amenities: {} });
      expect(where).toEqual({});
    });

    it("ignores amenities when undefined", () => {
      const where = buildPubWhereClause({ amenities: undefined });
      expect(where).toEqual({});
    });
  });
});

describe("PUB_AMENITY_FIELDS", () => {
  it("contains all expected amenity fields", () => {
    expect(PUB_AMENITY_FIELDS).toEqual([
      { key: "isIndependent", label: "Independent" },
      { key: "hasFood", label: "Food available" },
      { key: "hasSundayRoast", label: "Sunday roast" },
      { key: "hasBeerGarden", label: "Beer garden" },
      { key: "hasCaskAle", label: "Cask ale" },
      { key: "isBeerFocused", label: "Beer-focused" },
      { key: "isDogFriendly", label: "Dog friendly" },
      { key: "isFamilyFriendly", label: "Family friendly" },
      { key: "hasStepFreeAccess", label: "Step-free access" },
      { key: "hasAccessibleToilet", label: "Accessible toilet" },
      { key: "hasLiveSport", label: "Live sport" },
      { key: "hasLiveMusic", label: "Live music" },
    ]);
  });
});

describe("parsePagination", () => {
  it("defaults to page 1 and limit 50", () => {
    expect(parsePagination()).toEqual({ pageNum: 1, limitNum: 50, skip: 0 });
  });

  it("calculates skip from page and limit", () => {
    expect(parsePagination("3", "20")).toMatchObject({ skip: 40 });
  });

  it("clamps limit to maxLimit", () => {
    const result = parsePagination("1", "200", 100);
    expect(result.limitNum).toBe(100);
  });

  it("treats page < 1 as page 1", () => {
    expect(parsePagination("0", "10")).toMatchObject({ pageNum: 1, skip: 0 });
  });

  it("treats non-numeric page as page 1", () => {
    expect(parsePagination("abc", "10")).toMatchObject({
      pageNum: 1,
      skip: 0,
    });
  });

  it("treats non-numeric limit as default 50", () => {
    expect(parsePagination("1", "abc")).toMatchObject({ limitNum: 50 });
  });
});
