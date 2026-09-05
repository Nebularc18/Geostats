ALTER TABLE "caches"
  ADD COLUMN "metadata_trusted" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows may have been established by an ordinary user import. Reset
-- them to identity-only placeholders; the trusted admin import enriches them.
UPDATE "caches"
SET "name" = "gc_code",
    "cache_type" = NULL,
    "difficulty" = NULL,
    "terrain" = NULL,
    "size" = NULL,
    "latitude" = 0,
    "longitude" = 0,
    "country" = NULL,
    "region" = NULL,
    "county" = NULL,
    "hidden_date" = NULL,
    "owner_name" = NULL,
    "metadata_trusted" = false;
