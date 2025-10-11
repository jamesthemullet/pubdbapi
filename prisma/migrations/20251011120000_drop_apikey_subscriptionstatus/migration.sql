-- Drop subscriptionStatus column from ApiKey (we now use keyStatus)
ALTER TABLE "public"."ApiKey" DROP COLUMN IF EXISTS "subscriptionStatus";
