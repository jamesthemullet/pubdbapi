-- AlterTable
ALTER TABLE "Pub" ADD COLUMN     "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Pub_createdById_idx" ON "Pub"("createdById");

-- AddForeignKey
ALTER TABLE "Pub" ADD CONSTRAINT "Pub_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
