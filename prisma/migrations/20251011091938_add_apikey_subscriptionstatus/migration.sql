-- AlterTable
ALTER TABLE "public"."ApiKey" ADD COLUMN     "subscriptionStatus" "public"."SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE';
