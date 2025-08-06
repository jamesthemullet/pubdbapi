import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

async function createSampleApiKeys() {
  // First, we need a user to assign API keys to
  let testUser = await prisma.user.findFirst({
    where: { email: "test@example.com" },
  });

  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        name: "Test User",
        email: "test@example.com",
        approved: true,
        emailVerified: true,
      },
    });
  }

  // Create API keys for each tier
  const apiKeys = [
    {
      name: "Testing API Key",
      tier: "TESTING",
      key: "test-api-key-12345",
    },
    {
      name: "Developer API Key",
      tier: "DEVELOPER",
      key: "dev-api-key-67890",
    },
    {
      name: "Business API Key",
      tier: "BUSINESS",
      key: "biz-api-key-abcde",
    },
  ];

  for (const keyData of apiKeys) {
    const keyHash = crypto
      .createHash("sha256")
      .update(keyData.key)
      .digest("hex");
    const keyPrefix = keyData.key.substring(0, 8);

    // Check if key already exists
    const existing = await prisma.apiKey.findFirst({
      where: { keyHash },
    });

    if (!existing) {
      await prisma.apiKey.create({
        data: {
          name: keyData.name,
          keyHash,
          keyPrefix,
          userId: testUser.id,
          tier: keyData.tier as any,
          isActive: true,
        },
      });
      console.log(`Created ${keyData.tier} API key: ${keyData.key}`);
    } else {
      console.log(`${keyData.tier} API key already exists: ${keyData.key}`);
    }
  }

  await prisma.$disconnect();
}

createSampleApiKeys().catch(console.error);
