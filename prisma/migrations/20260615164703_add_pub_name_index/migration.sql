-- DropIndex
DROP INDEX "AuditLog_action_entity_userId_idx";

-- DropIndex
DROP INDEX "AuditLog_timestamp_idx";

-- DropIndex
DROP INDEX "AuditLog_userId_timestamp_idx";

-- CreateIndex
CREATE INDEX "Pub_name_idx" ON "Pub"("name");
