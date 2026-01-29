import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const beerTypes = [
  { name: "Lager", colour: "PALE" },
  { name: "Pilsner", colour: "GOLDEN" },
  { name: "IPA", colour: "GOLDEN" },
  { name: "Session IPA", colour: "PALE" },
  { name: "Pale Ale", colour: "GOLDEN" },
  { name: "Golden Ale", colour: "GOLDEN" },
  { name: "Bitter", colour: "AMBER" },
  { name: "Best Bitter", colour: "AMBER" },
  { name: "Mild", colour: "BROWN" },
  { name: "Stout", colour: "BLACK" },
  { name: "Porter", colour: "DARK" },
  { name: "Brown Ale", colour: "BROWN" },
  { name: "Wheat Beer", colour: "PALE" },
  { name: "Sour", colour: "PALE" },
  { name: "Belgian Ale", colour: "GOLDEN" },
  { name: "Barley Wine", colour: "AMBER" },
] as const;

async function main() {
  await Promise.all(
    beerTypes.map((type) =>
      prisma.beerType.upsert({
        where: { name: type.name },
        create: {
          name: type.name,
          colour: type.colour,
          isSystem: true,
          isActive: true,
        },
        update: {
          colour: type.colour,
          isSystem: true,
          isActive: true,
        },
      })
    )
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
