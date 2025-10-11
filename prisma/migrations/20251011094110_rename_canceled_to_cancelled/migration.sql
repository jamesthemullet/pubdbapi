/*
  Warnings:

  - The values [CANCELED] on the enum `SubscriptionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."SubscriptionStatus_new" AS ENUM ('INACTIVE', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'INCOMPLETE', 'TRIALING');
ALTER TABLE "public"."ApiKey" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;
ALTER TABLE "public"."User" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;
ALTER TABLE "public"."User" ALTER COLUMN "subscriptionStatus" TYPE "public"."SubscriptionStatus_new" USING ("subscriptionStatus"::text::"public"."SubscriptionStatus_new");
ALTER TABLE "public"."ApiKey" ALTER COLUMN "subscriptionStatus" TYPE "public"."SubscriptionStatus_new" USING ("subscriptionStatus"::text::"public"."SubscriptionStatus_new");
ALTER TYPE "public"."SubscriptionStatus" RENAME TO "SubscriptionStatus_old";
ALTER TYPE "public"."SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
DROP TYPE "public"."SubscriptionStatus_old";
ALTER TABLE "public"."ApiKey" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'INACTIVE';
ALTER TABLE "public"."User" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'INACTIVE';
COMMIT;
