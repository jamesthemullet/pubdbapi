import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

const CSV_MODE = process.argv.includes("--csv");

function makePrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = CSV_MODE ? null : makePrisma();

const FSA_BASE = "https://api.ratings.food.gov.uk";
const FSA_HEADERS = { "x-api-version": "2", Accept: "application/json" };

const PUB_BUSINESS_TYPE_ID = 7844;
const PAGE_SIZE = 100;

const LONDON_BOROUGHS = new Set([
  "Barking and Dagenham",
  "Barnet",
  "Bexley",
  "Brent",
  "Bromley",
  "Camden",
  "City of London",
  "Croydon",
  "Ealing",
  "Enfield",
  "Greenwich",
  "Hackney",
  "Hammersmith and Fulham",
  "Haringey",
  "Harrow",
  "Havering",
  "Hillingdon",
  "Hounslow",
  "Islington",
  "Kensington and Chelsea",
  "Kingston upon Thames",
  "Lambeth",
  "Lewisham",
  "Merton",
  "Newham",
  "Redbridge",
  "Richmond upon Thames",
  "Southwark",
  "Sutton",
  "Tower Hamlets",
  "Waltham Forest",
  "Wandsworth",
  "Westminster",
]);

interface FsaAuthority {
  LocalAuthorityId: number;
  Name: string;
}

interface FsaEstablishment {
  BusinessName: string;
  AddressLine1: string;
  AddressLine2: string;
  AddressLine3: string;
  AddressLine4: string;
  PostCode: string;
  LocalAuthorityName: string;
  geocode: {
    longitude: string | null;
    latitude: string | null;
  };
}

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADERS = ["name", "address", "city", "postcode", "country", "lat", "lng", "borough"];

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: FSA_HEADERS });
  if (!res.ok) throw new Error(`FSA API error ${res.status}: ${url}`);
  return res.json();
}

async function getLondonAuthorityIds(): Promise<{ id: number; name: string }[]> {
  const data = await fetchJson(`${FSA_BASE}/LocalAuthorities`);
  const authorities: FsaAuthority[] = data.localAuthorities ?? data;
  return authorities
    .filter((a) => LONDON_BOROUGHS.has(a.Name))
    .map((a) => ({ id: a.LocalAuthorityId, name: a.Name }));
}

async function fetchPubsForAuthority(authorityId: number): Promise<FsaEstablishment[]> {
  const results: FsaEstablishment[] = [];
  let page = 1;

  while (true) {
    const url =
      `${FSA_BASE}/Establishments` +
      `?localAuthorityId=${authorityId}` +
      `&businessTypeId=${PUB_BUSINESS_TYPE_ID}` +
      `&pageSize=${PAGE_SIZE}` +
      `&pageNumber=${page}`;

    const data = await fetchJson(url);
    const establishments: FsaEstablishment[] = data.establishments ?? [];

    if (establishments.length === 0) break;
    results.push(...establishments);
    if (establishments.length < PAGE_SIZE) break;
    page++;
  }

  return results;
}

async function run() {
  console.log("Fetching London local authorities from FSA API...");
  const authorities = await getLondonAuthorityIds();
  console.log(`Found ${authorities.length} London authorities`);

  const csvRows: string[] = [];
  if (CSV_MODE) {
    csvRows.push(CSV_HEADERS.join(","));
  }

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const authority of authorities) {
    console.log(`Fetching pubs for ${authority.name}...`);
    const establishments = await fetchPubsForAuthority(authority.id);
    console.log(`  ${establishments.length} pubs found`);

    for (const est of establishments) {
      const name = est.BusinessName?.trim();
      if (!name) {
        skipped++;
        continue;
      }

      const lat = est.geocode?.latitude ? parseFloat(est.geocode.latitude) : null;
      const lng = est.geocode?.longitude ? parseFloat(est.geocode.longitude) : null;
      const postcode = est.PostCode?.trim() || "";

      const addressParts = [
        est.AddressLine1,
        est.AddressLine2,
        est.AddressLine3,
        est.AddressLine4,
      ].filter(Boolean);
      const address = addressParts[0] || "";
      const city = addressParts[addressParts.length - 1] || "London";

      if (CSV_MODE) {
        csvRows.push(
          [name, address, city, postcode, "GB", lat, lng, authority.name]
            .map(escapeCsv)
            .join(",")
        );
        added++;
        continue;
      }

      const existing = await prisma!.pub.findFirst({
        where: { name, postcode: postcode || undefined },
        select: { id: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      try {
        await prisma!.pub.create({
          data: {
            name,
            city,
            postcode,
            address,
            country: "GB",
            lat,
            lng,
            borough: authority.name,
            website: null,
            operator: null,
            phone: null,
            openingHours: null,
            description: null,
            imageUrl: null,
            area: null,
          },
        });
        console.log(`  ✅ Added: ${name}`);
        added++;
      } catch (err) {
        console.error(`  ❌ Failed: ${name}`, err);
        failed++;
      }
    }
  }

  if (CSV_MODE) {
    const outPath = path.join(__dirname, "../pubs-fsa.csv");
    fs.writeFileSync(outPath, csvRows.join("\n"), "utf-8");
    console.log(`\nWrote ${added} pubs to ${outPath}`);
  } else {
    console.log(`\nDone: ${added} added, ${skipped} skipped, ${failed} failed`);
    await prisma!.$disconnect();
  }
}

run().catch(async (err) => {
  console.error(err);
  await prisma?.$disconnect();
  process.exit(1);
});
