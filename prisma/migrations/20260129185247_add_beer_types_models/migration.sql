-- CreateEnum
CREATE TYPE "public"."BeerColour" AS ENUM ('PALE', 'GOLDEN', 'AMBER', 'BROWN', 'DARK', 'BLACK');

-- CreateTable
CREATE TABLE "public"."BeerType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colour" "public"."BeerColour",
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PubBeerType" (
    "pubId" TEXT NOT NULL,
    "beerTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PubBeerType_pkey" PRIMARY KEY ("pubId","beerTypeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BeerType_name_key" ON "public"."BeerType"("name");

-- CreateIndex
CREATE INDEX "BeerType_isActive_idx" ON "public"."BeerType"("isActive");

-- CreateIndex
CREATE INDEX "BeerType_colour_idx" ON "public"."BeerType"("colour");

-- CreateIndex
CREATE INDEX "PubBeerType_beerTypeId_idx" ON "public"."PubBeerType"("beerTypeId");

-- AddForeignKey
ALTER TABLE "public"."PubBeerType" ADD CONSTRAINT "PubBeerType_pubId_fkey" FOREIGN KEY ("pubId") REFERENCES "public"."Pub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PubBeerType" ADD CONSTRAINT "PubBeerType_beerTypeId_fkey" FOREIGN KEY ("beerTypeId") REFERENCES "public"."BeerType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
