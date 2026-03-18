UPDATE "Pub"
SET "country" = 'GB'
WHERE "country" IS NULL OR btrim("country") = '';

ALTER TABLE "Pub"
ALTER COLUMN "country" SET NOT NULL;
