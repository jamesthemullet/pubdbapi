import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const raw = fs.readFileSync(
    path.join(__dirname, "../export.geojson"),
    "utf-8"
  );
  const data = JSON.parse(raw);

  const features = data.features;

  for (const feature of features) {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];

    const name = props.name;
    const city = props["addr:city"] || "London";
    const postcode = props["addr:postcode"] || "";
    const street = props["addr:street"] || "";
    const number = props["addr:housenumber"] || "";
    const address = `${number} ${street}`.trim();
    const operator = props.operator || null;
    const openingHours = props["opening_hours"] || null;

    const lat = coords[1];
    const lng = coords[0];
    const website = props.website || null;

    if (!name || !lat || !lng) continue;

    try {
      await prisma.pub.create({
        data: {
          name,
          city,
          postcode,
          address,
          lat,
          lng,
          website,
          description: null,
          imageUrl: null,
          operator,
          area: null,
          phone: props.phone || null,
          borough: null,
          openingHours,
        },
      });
      console.log(`✅ Added pub: ${name}`);
    } catch (err) {
      console.error(`❌ Failed to insert pub ${name}:`, err);
    }
  }

  await prisma.$disconnect();
}

run();
