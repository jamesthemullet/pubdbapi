import { prisma } from "../prisma";

export const PUB_AMENITY_FIELDS = [
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
] as const;

type AmenityKey = (typeof PUB_AMENITY_FIELDS)[number]["key"];

export interface PubListFilters {
  city?: string;
  name?: string;
  operator?: string;
  borough?: string;
  postcode?: string;
  area?: string;
  country?: string;
  search?: string;
  amenities?: Partial<Record<AmenityKey, boolean>>;
}

export function buildPubWhereClause(filters: PubListFilters) {
  const where: Record<string, unknown> = {};

  if (filters.search) {
    const term = { contains: filters.search, mode: "insensitive" };
    where.OR = [
      { name: term },
      { area: term },
      { borough: term },
      { city: term },
      { operator: term },
    ];
  }

  if (filters.city) {
    where.city = { equals: filters.city, mode: "insensitive" };
  }
  if (filters.name) {
    where.name = { contains: filters.name, mode: "insensitive" };
  }
  if (filters.operator) {
    where.operator = { contains: filters.operator, mode: "insensitive" };
  }
  if (filters.borough) {
    where.borough = { contains: filters.borough, mode: "insensitive" };
  }
  if (filters.postcode) {
    where.postcode = { equals: filters.postcode, mode: "insensitive" };
  }
  if (filters.area) {
    where.area = { equals: filters.area, mode: "insensitive" };
  }
  if (filters.country) {
    where.country = { equals: filters.country, mode: "insensitive" };
  }

  if (filters.amenities) {
    const andClauses: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(filters.amenities)) {
      if (value === undefined) continue;
      if (key === "hasBeerGarden" && value === true) {
        andClauses.push({ OR: [{ hasBeerGarden: true }, { beerGardens: { some: {} } }] });
      } else {
        where[key] = value;
      }
    }
    if (andClauses.length > 0) where.AND = andClauses;
  }

  return where;
}

export function parsePagination(
  page?: string,
  limit?: string,
  maxLimit = 10000
) {
  const parsedPage = Number.parseInt(page || "1", 10);
  const parsedLimit = Number.parseInt(limit || "50", 10);
  const pageNum = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const limitNum =
    Number.isNaN(parsedLimit) || parsedLimit < 1
      ? 50
      : Math.min(parsedLimit, maxLimit);
  const skip = (pageNum - 1) * limitNum;
  return { pageNum, limitNum, skip };
}

export async function listPubs(
  filters: PubListFilters,
  pagination: { skip: number; limitNum: number }
) {
  const where = buildPubWhereClause(filters);

  const [pubs, total] = await Promise.all([
    prisma.pub.findMany({
      where,
      orderBy: { name: "asc" },
      skip: pagination.skip,
      take: pagination.limitNum,
    }),
    prisma.pub.count({ where }),
  ]);

  return { pubs, total };
}

export async function getPubById(id: string) {
  return prisma.pub.findUnique({
    where: { id },
    include: {
      beerGardens: true,
      beerTypes: { include: { beerType: true } },
    },
  });
}
