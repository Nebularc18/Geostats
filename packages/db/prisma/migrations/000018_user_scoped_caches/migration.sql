ALTER TABLE "caches" ADD COLUMN "user_id" TEXT;

CREATE TEMP TABLE "_cache_user_map" AS
WITH cache_users AS (
  SELECT "cache_id", "user_id" FROM "finds"
  UNION
  SELECT "cache_id", "user_id" FROM "hides"
  UNION
  SELECT "cache_id", "user_id" FROM "corrected_coordinates"
), ranked AS (
  SELECT
    "cache_id",
    "user_id",
    ROW_NUMBER() OVER (PARTITION BY "cache_id" ORDER BY "user_id") AS "position"
  FROM cache_users
)
SELECT
  "cache_id" AS "original_cache_id",
  "user_id",
  CASE
    WHEN "position" = 1 THEN "cache_id"
    ELSE "cache_id" || '-' || SUBSTRING(MD5("user_id") FROM 1 FOR 12)
  END AS "new_cache_id",
  "position"
FROM ranked;

INSERT INTO "caches" (
  "id", "user_id", "gc_code", "name", "cache_type", "difficulty", "terrain",
  "size", "latitude", "longitude", "country", "region", "county", "hidden_date",
  "owner_name", "raw", "created_at", "updated_at"
)
SELECT
  mapping."new_cache_id", mapping."user_id", cache."gc_code", cache."name",
  cache."cache_type", cache."difficulty", cache."terrain", cache."size",
  cache."latitude", cache."longitude", cache."country", cache."region", cache."county",
  cache."hidden_date", cache."owner_name", cache."raw", cache."created_at", cache."updated_at"
FROM "_cache_user_map" AS mapping
JOIN "caches" AS cache ON cache."id" = mapping."original_cache_id"
WHERE mapping."position" > 1;

UPDATE "caches" AS cache
SET "user_id" = mapping."user_id"
FROM "_cache_user_map" AS mapping
WHERE cache."id" = mapping."original_cache_id"
  AND mapping."position" = 1;

UPDATE "finds" AS record
SET "cache_id" = mapping."new_cache_id"
FROM "_cache_user_map" AS mapping
WHERE record."cache_id" = mapping."original_cache_id"
  AND record."user_id" = mapping."user_id";

UPDATE "hides" AS record
SET "cache_id" = mapping."new_cache_id"
FROM "_cache_user_map" AS mapping
WHERE record."cache_id" = mapping."original_cache_id"
  AND record."user_id" = mapping."user_id";

UPDATE "corrected_coordinates" AS record
SET "cache_id" = mapping."new_cache_id"
FROM "_cache_user_map" AS mapping
WHERE record."cache_id" = mapping."original_cache_id"
  AND record."user_id" = mapping."user_id";

DELETE FROM "caches" WHERE "user_id" IS NULL;
DROP TABLE "_cache_user_map";

DROP INDEX "caches_gc_code_key";
ALTER TABLE "caches" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "caches"
  ADD CONSTRAINT "caches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "caches_user_id_gc_code_key" ON "caches"("user_id", "gc_code");
CREATE INDEX "caches_user_id_idx" ON "caches"("user_id");
