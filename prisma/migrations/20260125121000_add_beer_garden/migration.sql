DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SunExposure') THEN
    CREATE TYPE "SunExposure" AS ENUM ('FULL_SUN', 'PARTIAL_SUN', 'SHADED');
  END IF;
END
$$;

CREATE TABLE "BeerGarden" (
  "id" TEXT NOT NULL,
  "pubId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "seatingCapacity" INTEGER,
  "sunExposure" "SunExposure",
  "isCovered" BOOLEAN NOT NULL DEFAULT false,
  "isHeated" BOOLEAN NOT NULL DEFAULT false,
  "isFamilyFriendly" BOOLEAN NOT NULL DEFAULT false,
  "petFriendly" BOOLEAN NOT NULL DEFAULT false,
  "openingHours" JSONB,
  "imageUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BeerGarden_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BeerGarden_pubId_idx" ON "BeerGarden"("pubId");

ALTER TABLE "BeerGarden"
ADD CONSTRAINT "BeerGarden_pubId_fkey"
FOREIGN KEY ("pubId") REFERENCES "Pub"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
