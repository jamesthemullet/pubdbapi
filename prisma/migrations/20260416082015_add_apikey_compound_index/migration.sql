-- DropIndex
DROP INDEX "ApiKey_keyHash_idx";

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_isActive_idx" ON "ApiKey"("keyHash", "isActive");
