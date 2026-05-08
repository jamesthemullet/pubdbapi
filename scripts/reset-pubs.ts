import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log("Deleting PubBeerType records...");
  const { count: beerTypeCount } = await prisma.pubBeerType.deleteMany();
  console.log(`  Deleted ${beerTypeCount} rows`);

  console.log("Deleting BeerGarden records...");
  const { count: beerGardenCount } = await prisma.beerGarden.deleteMany();
  console.log(`  Deleted ${beerGardenCount} rows`);

  console.log("Deleting Pub records...");
  const { count: pubCount } = await prisma.pub.deleteMany();
  console.log(`  Deleted ${pubCount} rows`);

  console.log("Done.");
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
