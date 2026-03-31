import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type PrismaGlobal = typeof globalThis & {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

const globalForPrisma = globalThis as PrismaGlobal;

function getAdapter() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return undefined;
  }

  const pool =
    globalForPrisma.prismaPool ?? new Pool({ connectionString });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prismaPool = pool;
  }

  return new PrismaPg(pool);
}

const adapter = getAdapter();

export const prisma =
  globalForPrisma.prisma ??
  (adapter ? new PrismaClient({ adapter }) : new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}