BEGIN;

CREATE TEMP TABLE "cache_merge_map" ON COMMIT DROP AS
SELECT "id" AS "duplicate_id",
       first_value("id") OVER (
         PARTITION BY upper(trim("gc_code"))
         ORDER BY "updated_at" DESC, "created_at" DESC, "id"
       ) AS "canonical_id"
FROM "caches";

CREATE TABLE "user_cache_data" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cache_id" TEXT NOT NULL,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_cache_data_pkey" PRIMARY KEY ("id")
);

INSERT INTO "user_cache_data" ("id", "user_id", "cache_id", "raw", "created_at", "updated_at")
SELECT 'ucd_' || md5(chosen."user_id" || ':' || chosen."canonical_id"),
       chosen."user_id",
       chosen."canonical_id",
       chosen."raw",
       chosen."created_at",
       chosen."updated_at"
FROM (
  SELECT DISTINCT ON (c."user_id", m."canonical_id")
         c."user_id", m."canonical_id", c."raw", c."created_at", c."updated_at"
  FROM "caches" c
  JOIN "cache_merge_map" m ON m."duplicate_id" = c."id"
  ORDER BY c."user_id", m."canonical_id", c."updated_at" DESC, c."id"
) chosen;

CREATE TEMP TABLE "find_merge_map" ON COMMIT DROP AS
SELECT f."id" AS "relation_id", m."canonical_id" AS "cache_id",
       first_value(f."id") OVER (
         PARTITION BY f."user_id", m."canonical_id", f."found_at"
         ORDER BY f."is_ftf_manual" DESC, f."updated_at" DESC, f."id"
       ) AS "canonical_relation_id"
FROM "finds" f
JOIN "cache_merge_map" m ON m."duplicate_id" = f."cache_id";

UPDATE "finds" kept
SET "log_text" = COALESCE(kept."log_text", merged."log_text"),
    "is_ftf" = merged."is_ftf",
    "is_ftf_manual" = merged."is_ftf_manual",
    "updated_at" = merged."updated_at"
FROM (
  SELECT fm."canonical_relation_id",
         max(f."log_text") FILTER (WHERE f."log_text" IS NOT NULL) AS "log_text",
         bool_or(f."is_ftf") AS "is_ftf",
         bool_or(f."is_ftf_manual") AS "is_ftf_manual",
         max(f."updated_at") AS "updated_at"
  FROM "find_merge_map" fm
  JOIN "finds" f ON f."id" = fm."relation_id"
  GROUP BY fm."canonical_relation_id"
) merged
WHERE kept."id" = merged."canonical_relation_id";

DELETE FROM "finds" relation
USING "find_merge_map" fm
WHERE relation."id" = fm."relation_id" AND fm."relation_id" <> fm."canonical_relation_id";

UPDATE "finds" relation SET "cache_id" = fm."cache_id"
FROM "find_merge_map" fm
WHERE relation."id" = fm."canonical_relation_id" AND relation."cache_id" <> fm."cache_id";

CREATE TEMP TABLE "hide_merge_map" ON COMMIT DROP AS
SELECT h."id" AS "relation_id", m."canonical_id" AS "cache_id",
       first_value(h."id") OVER (
         PARTITION BY h."user_id", m."canonical_id"
         ORDER BY h."received_log_count" DESC, h."updated_at" DESC, h."id"
       ) AS "canonical_relation_id"
FROM "hides" h
JOIN "cache_merge_map" m ON m."duplicate_id" = h."cache_id";

UPDATE "hides" kept
SET "placed_at" = COALESCE(kept."placed_at", merged."placed_at"),
    "received_log_count" = merged."received_log_count",
    "received_logs_raw" = COALESCE(kept."received_logs_raw", merged."received_logs_raw"),
    "updated_at" = merged."updated_at"
FROM (
  SELECT hm."canonical_relation_id",
         min(h."placed_at") AS "placed_at",
         max(h."received_log_count") AS "received_log_count",
         (jsonb_agg(h."received_logs_raw") FILTER (WHERE h."received_logs_raw" IS NOT NULL))->0 AS "received_logs_raw",
         max(h."updated_at") AS "updated_at"
  FROM "hide_merge_map" hm
  JOIN "hides" h ON h."id" = hm."relation_id"
  GROUP BY hm."canonical_relation_id"
) merged
WHERE kept."id" = merged."canonical_relation_id";

DELETE FROM "hides" relation
USING "hide_merge_map" hm
WHERE relation."id" = hm."relation_id" AND hm."relation_id" <> hm."canonical_relation_id";

UPDATE "hides" relation SET "cache_id" = hm."cache_id"
FROM "hide_merge_map" hm
WHERE relation."id" = hm."canonical_relation_id" AND relation."cache_id" <> hm."cache_id";

CREATE TEMP TABLE "correction_merge_map" ON COMMIT DROP AS
SELECT correction."id" AS "relation_id", m."canonical_id" AS "cache_id",
       first_value(correction."id") OVER (
         PARTITION BY correction."user_id", m."canonical_id"
         ORDER BY correction."updated_at" DESC, correction."id"
       ) AS "canonical_relation_id"
FROM "corrected_coordinates" correction
JOIN "cache_merge_map" m ON m."duplicate_id" = correction."cache_id";

DELETE FROM "corrected_coordinates" relation
USING "correction_merge_map" cm
WHERE relation."id" = cm."relation_id" AND cm."relation_id" <> cm."canonical_relation_id";

UPDATE "corrected_coordinates" relation SET "cache_id" = cm."cache_id"
FROM "correction_merge_map" cm
WHERE relation."id" = cm."canonical_relation_id" AND relation."cache_id" <> cm."cache_id";

DELETE FROM "caches" duplicate
USING "cache_merge_map" m
WHERE duplicate."id" = m."duplicate_id" AND m."duplicate_id" <> m."canonical_id";

UPDATE "caches" SET "gc_code" = upper(trim("gc_code"));

DROP INDEX "caches_user_id_gc_code_key";
DROP INDEX "caches_user_id_idx";
ALTER TABLE "caches" DROP CONSTRAINT "caches_user_id_fkey";
ALTER TABLE "caches" DROP COLUMN "user_id";
ALTER TABLE "caches" DROP COLUMN "raw";

CREATE UNIQUE INDEX "caches_gc_code_key" ON "caches"("gc_code");
ALTER TABLE "caches" ADD CONSTRAINT "caches_gc_code_normalized" CHECK ("gc_code" = upper(trim("gc_code")));

CREATE UNIQUE INDEX "user_cache_data_user_id_cache_id_key" ON "user_cache_data"("user_id", "cache_id");
CREATE INDEX "user_cache_data_cache_id_idx" ON "user_cache_data"("cache_id");
ALTER TABLE "user_cache_data" ADD CONSTRAINT "user_cache_data_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_cache_data" ADD CONSTRAINT "user_cache_data_cache_id_fkey"
  FOREIGN KEY ("cache_id") REFERENCES "caches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
