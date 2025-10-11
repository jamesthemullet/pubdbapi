const { PrismaClient } = require("@prisma/client");

(async () => {
  const prisma = new PrismaClient();
  try {
    console.log("Starting ApiKey.subscriptionStatus sync...");
    const users = await prisma.user.findMany({
      select: { id: true, subscriptionStatus: true },
    });
    let total = 0;
    for (const u of users) {
      if (!u.subscriptionStatus) continue;
      const res = await prisma.apiKey.updateMany({
        where: { userId: u.id, subscriptionStatus: "INACTIVE" },
        data: { subscriptionStatus: u.subscriptionStatus },
      });
      if (res.count) {
        console.log(
          `Updated ${res.count} apiKeys for user ${u.id} -> ${u.subscriptionStatus}`
        );
        total += res.count;
      }
    }
    console.log(`Sync complete. Total apiKeys updated: ${total}`);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err);
    try {
      await prisma.$disconnect();
    } catch (e) {}
    process.exit(1);
  }
})();
