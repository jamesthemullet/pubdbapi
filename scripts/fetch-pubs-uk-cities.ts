import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
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

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// [south, west, north, east]
const UK_CITIES: { name: string; bbox: [number, number, number, number] }[] = [
  { name: "Birmingham",       bbox: [52.35, -2.05, 52.60, -1.70] },
  { name: "Manchester",       bbox: [53.33, -2.45, 53.58, -2.05] },
  { name: "Leeds",            bbox: [53.73, -1.65, 53.88, -1.42] },
  { name: "Sheffield",        bbox: [53.28, -1.62, 53.47, -1.32] },
  { name: "Liverpool",        bbox: [53.30, -3.08, 53.50, -2.82] },
  { name: "Edinburgh",        bbox: [55.86, -3.38, 56.00, -3.08] },
  { name: "Glasgow",          bbox: [55.78, -4.38, 55.92, -4.12] },
  { name: "Bristol",          bbox: [51.38, -2.68, 51.53, -2.48] },
  { name: "Cardiff",          bbox: [51.44, -3.27, 51.53, -3.10] },
  { name: "Leicester",        bbox: [52.57, -1.20, 52.68, -1.04] },
  { name: "Nottingham",       bbox: [52.88, -1.23, 52.98, -1.09] },
  { name: "Newcastle",        bbox: [54.93, -1.70, 55.03, -1.55] },
  { name: "Brighton",         bbox: [50.80, -0.20, 50.87, -0.07] },
  { name: "Southampton",      bbox: [50.86, -1.44, 50.95, -1.34] },
  { name: "Portsmouth",       bbox: [50.76, -1.12, 50.84, -1.03] },
  { name: "Plymouth",         bbox: [50.34, -4.20, 50.41, -4.08] },
  { name: "Derby",            bbox: [52.87, -1.53, 52.96, -1.41] },
  { name: "Coventry",         bbox: [52.37, -1.57, 52.45, -1.44] },
  { name: "Stoke-on-Trent",   bbox: [52.97, -2.22, 53.06, -2.12] },
  { name: "Wolverhampton",    bbox: [52.56, -2.17, 52.62, -2.08] },
  { name: "Hull",             bbox: [53.72, -0.42, 53.78, -0.28] },
  { name: "York",             bbox: [53.92, -1.14, 53.98, -1.04] },
  { name: "Oxford",           bbox: [51.72, -1.32, 51.78, -1.19] },
  { name: "Cambridge",        bbox: [52.17,  0.07, 52.24,  0.16] },
  { name: "Norwich",          bbox: [52.59,  1.25, 52.65,  1.34] },
  { name: "Exeter",           bbox: [50.70, -3.56, 50.75, -3.50] },
  { name: "Bath",             bbox: [51.36, -2.41, 51.40, -2.33] },
  { name: "Sunderland",       bbox: [54.88, -1.42, 54.94, -1.35] },
  { name: "Middlesbrough",    bbox: [54.54, -1.28, 54.58, -1.20] },
  { name: "Belfast",          bbox: [54.55, -6.02, 54.64, -5.88] },
  { name: "Aberdeen",         bbox: [57.11, -2.15, 57.18, -2.06] },
  { name: "Dundee",           bbox: [56.44, -3.04, 56.49, -2.96] },
  { name: "Swansea",          bbox: [51.59, -4.00, 51.65, -3.91] },
  { name: "Reading",          bbox: [51.43, -1.02, 51.48, -0.93] },
  { name: "Milton Keynes",    bbox: [51.98, -0.82, 52.07, -0.72] },
  { name: "Luton",            bbox: [51.86, -0.45, 51.91, -0.39] },
  { name: "Bournemouth",      bbox: [50.70, -1.92, 50.74, -1.84] },
  { name: "Swindon",          bbox: [51.53, -1.81, 51.58, -1.75] },
  { name: "Northampton",      bbox: [52.22, -0.93, 52.27, -0.85] },
  { name: "Peterborough",     bbox: [52.55, -0.29, 52.60, -0.21] },
  { name: "Ipswich",          bbox: [52.03,  1.12, 52.08,  1.19] },
  { name: "Preston",          bbox: [53.74, -2.74, 53.79, -2.67] },
  { name: "Blackpool",        bbox: [53.79, -3.08, 53.84, -3.01] },
  { name: "Carlisle",         bbox: [54.88, -2.96, 54.92, -2.91] },
  { name: "Durham",           bbox: [54.76, -1.60, 54.79, -1.55] },
  { name: "Gloucester",       bbox: [51.84, -2.28, 51.87, -2.23] },
  { name: "Cheltenham",       bbox: [51.87, -2.11, 51.92, -2.04] },
  { name: "Lancaster",        bbox: [54.04, -2.83, 54.07, -2.78] },
  { name: "Inverness",        bbox: [57.45, -4.25, 57.49, -4.20] },
  { name: "Stirling",         bbox: [56.11, -3.95, 56.13, -3.93] },
];

function buildQuery(bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:60];(node["amenity"="pub"](${s},${w},${n},${e});way["amenity"="pub"](${s},${w},${n},${e}););out center body;`;
}

async function fetchFromOverpass(query: string): Promise<Response> {
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const r = await fetch(mirror, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "pub-api-importer/1.0",
          Accept: "*/*",
        },
      });
      if (r.ok) return r;
      console.warn(`    ${mirror} → ${r.status} — trying next`);
    } catch (err) {
      console.warn(`    ${mirror} → connection failed — trying next`);
    }
    await sleep(1000);
  }
  throw new Error("All Overpass mirrors failed");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_HEADERS = ["name", "address", "city", "postcode", "country", "lat", "lng", "website", "operator", "phone", "opening_hours"];

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

async function run() {
  const csvRows: string[] = [];
  if (CSV_MODE) csvRows.push(CSV_HEADERS.join(","));

  let totalAdded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const city of UK_CITIES) {
    console.log(`\nFetching pubs for ${city.name}...`);

    let elements: OverpassElement[] = [];
    try {
      const response = await fetchFromOverpass(buildQuery(city.bbox));
      const data = await response.json();
      elements = data.elements ?? [];
      console.log(`  ${elements.length} elements found`);
    } catch (err) {
      console.error(`  Failed to fetch ${city.name}:`, err);
      continue;
    }

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const el of elements) {
      const tags = el.tags || {};
      const name = tags.name;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;

      if (!name || lat === undefined || lng === undefined) {
        skipped++;
        continue;
      }

      const number = tags["addr:housenumber"] || "";
      const street = tags["addr:street"] || "";
      const address = `${number} ${street}`.trim();
      const pubCity = tags["addr:city"] || tags["addr:town"] || city.name;
      const postcode = tags["addr:postcode"] || "";
      const website = tags.website || null;
      const operator = tags.operator || null;
      const phone = tags.phone || null;
      const openingHours = tags.opening_hours || null;

      if (CSV_MODE) {
        csvRows.push(
          [name, address, pubCity, postcode, "GB", lat, lng, website, operator, phone, openingHours]
            .map(escapeCsv)
            .join(",")
        );
        added++;
        continue;
      }

      const existing = await prisma!.pub.findFirst({
        where: { name, lat, lng },
        select: { id: true },
      });

      if (existing) { skipped++; continue; }

      try {
        await prisma!.pub.create({
          data: {
            name,
            city: pubCity,
            postcode,
            address,
            country: "GB",
            lat,
            lng,
            website,
            operator,
            phone,
            openingHours: openingHours ?? Prisma.DbNull,
            description: null,
            imageUrl: null,
            area: null,
            borough: null,
          },
        });
        added++;
      } catch (err) {
        console.error(`  ❌ Failed: ${name}`, err);
        failed++;
      }
    }

    console.log(`  ${added} added, ${skipped} skipped, ${failed} failed`);
    totalAdded += added;
    totalSkipped += skipped;
    totalFailed += failed;

    // Be polite to the Overpass API between cities
    await sleep(2000);
  }

  if (CSV_MODE) {
    const outPath = path.join(__dirname, "../pubs-uk-cities.csv");
    fs.writeFileSync(outPath, csvRows.join("\n"), "utf-8");
    console.log(`\nWrote ${totalAdded} pubs to ${outPath}`);
  } else {
    console.log(`\nTotal: ${totalAdded} added, ${totalSkipped} skipped, ${totalFailed} failed`);
    await prisma!.$disconnect();
  }
}

run().catch(async (err) => {
  console.error(err);
  await prisma?.$disconnect();
  process.exit(1);
});
