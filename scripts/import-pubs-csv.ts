import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CSV_FILE = process.argv[2] ?? path.join(__dirname, "../pubs-overpass.csv");

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function run() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`CSV file not found: ${CSV_FILE}`);
  }

  const lines = fs.readFileSync(CSV_FILE, "utf-8").split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  console.log(`Reading ${lines.length - 1} pubs from ${CSV_FILE}`);

  const col = (row: string[], name: string) => {
    const i = headers.indexOf(name);
    return i >= 0 ? row[i] || null : null;
  };

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const name = col(row, "name");
    if (!name) { skipped++; continue; }

    const latRaw = col(row, "lat");
    const lngRaw = col(row, "lng");
    const lat = latRaw ? parseFloat(latRaw) : null;
    const lng = lngRaw ? parseFloat(lngRaw) : null;

    const existing = await prisma.pub.findFirst({
      where: { name, lat: lat ?? undefined, lng: lng ?? undefined },
      select: { id: true },
    });

    if (existing) { skipped++; continue; }

    try {
      const openingHours = col(row, "opening_hours");
      await prisma.pub.create({
        data: {
          name,
          address: col(row, "address") ?? "",
          city: col(row, "city") ?? "London",
          postcode: col(row, "postcode") ?? "",
          country: col(row, "country") ?? "GB",
          lat,
          lng,
          website: col(row, "website"),
          operator: col(row, "operator"),
          phone: col(row, "phone"),
          borough: col(row, "borough"),
          openingHours: openingHours ?? Prisma.DbNull,
          description: null,
          imageUrl: null,
          area: null,
        },
      });
      console.log(`✅ ${name}`);
      added++;
    } catch (err) {
      console.error(`❌ ${name}`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${added} added, ${skipped} skipped, ${failed} failed`);
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
