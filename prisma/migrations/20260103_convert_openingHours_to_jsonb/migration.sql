
BEGIN;

-- Create helper to test JSON validity safely
CREATE OR REPLACE FUNCTION public.is_valid_json(text) RETURNS boolean AS $$
BEGIN
  PERFORM $1::jsonb;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Delete the single problematic value (explicitly requested)
DELETE FROM "Pub" WHERE id = 'cmjy245xw0000ftnsnk7csk0x';

-- Delete any rows where openingHours is present but not valid JSON
DELETE FROM "Pub"
WHERE "openingHours" IS NOT NULL
  AND trim("openingHours") <> ''
  AND NOT public.is_valid_json("openingHours");

-- Alter column type to jsonb using a safe cast for any remaining rows
ALTER TABLE "Pub" ALTER COLUMN "openingHours" TYPE jsonb USING (
  CASE
    WHEN "openingHours" IS NULL OR trim("openingHours") = '' THEN NULL
    ELSE "openingHours"::jsonb
  END
);

-- Drop helper
DROP FUNCTION public.is_valid_json(text);

COMMIT;
