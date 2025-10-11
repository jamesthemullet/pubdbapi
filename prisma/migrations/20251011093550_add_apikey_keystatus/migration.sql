-- CreateEnum
CREATE TYPE "public"."KeyStatus" AS ENUM ('ACTIVE', 'SCHEDULED_EXPIRE', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "public"."ApiKey" ADD COLUMN     "keyStatus" "public"."KeyStatus" NOT NULL DEFAULT 'ACTIVE';
