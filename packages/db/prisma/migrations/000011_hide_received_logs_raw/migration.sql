ALTER TABLE "hides"
  ADD COLUMN "received_logs_raw" JSONB;

UPDATE "hides" AS "hide"
SET "received_logs_raw" = "cache"."raw"
FROM "caches" AS "cache"
WHERE "hide"."cache_id" = "cache"."id"
  AND "hide"."received_logs_raw" IS NULL
  AND "cache"."raw" IS NOT NULL;
