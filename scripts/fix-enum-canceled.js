const { PrismaClient } = require("@prisma/client");

(async () => {
  const prisma = new PrismaClient();
  try {
    console.log("Searching for CANCELED values...");
    const users = await prisma.user.findMany({
      where: { subscriptionStatus: "CANCELED" },
      select: { id: true },
    });
    const apiKeys = await prisma.apiKey.findMany({
      where: { subscriptionStatus: "CANCELED" },
      select: { id: true, userId: true },
    });

    console.log(
      `Found ${users.length} users and ${apiKeys.length} apiKeys with CANCELED`
    );

    if (users.length) {
      const ures = await prisma.user.updateMany({
        where: { subscriptionStatus: "CANCELED" },
        data: { subscriptionStatus: "CANCELLED" },
      });
      console.log("Updated users:", ures.count);
    }
    if (apiKeys.length) {
      const ares = await prisma.apiKey.updateMany({
        where: { subscriptionStatus: "CANCELED" },
        data: { subscriptionStatus: "CANCELLED" },
      });
      console.log("Updated apiKeys:", ares.count);
    }

    await prisma.$disconnect();
    console.log("Done");
  } catch (err) {
    console.error("Fix failed", err);
    try {
      await prisma.$disconnect();
    } catch (e) {}
    process.exit(1);
  }
})();
