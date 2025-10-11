const { PrismaClient } = require("@prisma/client");

(async () => {
  const prisma = new PrismaClient();
  try {
    console.log("Starting ApiKey.keyStatus backfill...");
    const apiKeys = await prisma.apiKey.findMany({
      select: { id: true, isActive: true, expiresAt: true, keyStatus: true },
    });

    let updated = 0;
    for (const k of apiKeys) {
      let desired;
      if (!k.isActive) {
        desired = "REVOKED";
      } else if (k.expiresAt) {
        const now = new Date();
        if (k.expiresAt > now) desired = "SCHEDULED_EXPIRE";
        else desired = "EXPIRED";
      } else {
        desired = "ACTIVE";
      }

      if (k.keyStatus !== desired) {
        await prisma.apiKey.update({ where: { id: k.id }, data: { keyStatus: desired } });
        updated++;
      }
    }

    console.log(`Backfill complete. Updated ${updated} apiKeys.`);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Backfill failed:", err);
    try { await prisma.$disconnect(); } catch (e) {}
    process.exit(1);
  }
})();
