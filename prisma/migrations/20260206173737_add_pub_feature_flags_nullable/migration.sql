-- AlterTable
ALTER TABLE "public"."Pub" ADD COLUMN     "chainName" TEXT,
ADD COLUMN     "hasAccessibleToilet" BOOLEAN,
ADD COLUMN     "hasBeerGarden" BOOLEAN,
ADD COLUMN     "hasCaskAle" BOOLEAN,
ADD COLUMN     "hasFood" BOOLEAN,
ADD COLUMN     "hasLiveMusic" BOOLEAN,
ADD COLUMN     "hasLiveSport" BOOLEAN,
ADD COLUMN     "hasStepFreeAccess" BOOLEAN,
ADD COLUMN     "hasSundayRoast" BOOLEAN,
ADD COLUMN     "isBeerFocused" BOOLEAN,
ADD COLUMN     "isDogFriendly" BOOLEAN,
ADD COLUMN     "isFamilyFriendly" BOOLEAN,
ADD COLUMN     "isIndependent" BOOLEAN;
