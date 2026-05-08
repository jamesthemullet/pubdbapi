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

// Bounding box covering Greater London: south,west,north,east
const LONDON_BBOX = "51.28,-0.55,51.72,0.32";

const QUERY = `[out:json][timeout:120];(node["amenity"="pub"](${LONDON_BBOX});way["amenity"="pub"](${LONDON_BBOX}););out center body;`;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
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

async function run() {
  console.log("Fetching London pubs from Overpass API...");

  let response: Response | null = null;
  for (const mirror of OVERPASS_MIRRORS) {
    console.log(`Trying ${mirror}...`);
    try {
      const r = await fetch(mirror, {
        method: "POST",
        body: new URLSearchParams({ data: QUERY }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "pub-api-importer/1.0",
          Accept: "*/*",
        },
      });
      if (r.ok) { response = r; break; }
      console.warn(`  ${r.status} ${r.statusText} — trying next mirror`);
    } catch {
      console.warn(`  Connection failed — trying next mirror`);
    }
  }

  if (!response) {
    throw new Error("All Overpass mirrors failed");
  }

  const data = await response.json();
  const elements: OverpassElement[] = data.elements;

  console.log(`Found ${elements.length} elements from Overpass`);

  const csvRows: string[] = [];
  if (CSV_MODE) {
    csvRows.push(CSV_HEADERS.join(","));
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
    const city = tags["addr:city"] || tags["addr:town"] || "London";
    const postcode = tags["addr:postcode"] || "";
    const website = tags.website || null;
    const operator = tags.operator || null;
    const phone = tags.phone || null;
    const openingHours = tags.opening_hours || null;

    if (CSV_MODE) {
      csvRows.push(
        [name, address, city, postcode, "GB", lat, lng, website, operator, phone, openingHours]
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
      console.log(`✅ Added: ${name}`);
      added++;
    } catch (err) {
      console.error(`❌ Failed: ${name}`, err);
      failed++;
    }
  }

  if (CSV_MODE) {
    const outPath = path.join(__dirname, "../pubs-overpass.csv");
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
