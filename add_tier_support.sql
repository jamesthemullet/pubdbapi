-- Create enum for API key tiers first
CREATE TYPE "ApiKeyTier" AS ENUM ('TESTING', 'DEVELOPER', 'BUSINESS');

-- Add tier support to existing ApiKey table
ALTER TABLE "ApiKey" ADD COLUMN "tier" "ApiKeyTier" NOT NULL DEFAULT 'TESTING';
ALTER TABLE "ApiKey" ADD COLUMN "requestsPerHour" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ApiKey" ADD COLUMN "requestsPerDay" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "ApiKey" ADD COLUMN "requestsPerMonth" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "ApiKey" ADD COLUMN "currentMonthUsage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApiKey" ADD COLUMN "monthlyResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create usage tracking table
CREATE TABLE "ApiKeyUsage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ApiKeyUsage_pkey" PRIMARY KEY ("id")
);

-- Add foreign key constraint
ALTER TABLE "ApiKeyUsage" ADD CONSTRAINT "ApiKeyUsage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add indexes for performance
CREATE INDEX "ApiKeyUsage_apiKeyId_timestamp_idx" ON "ApiKeyUsage"("apiKeyId", "timestamp");
CREATE INDEX "ApiKeyUsage_timestamp_idx" ON "ApiKeyUsage"("timestamp");
