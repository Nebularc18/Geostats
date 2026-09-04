BEGIN;

WITH candidates AS (
  SELECT
    upper(trim(workspace."gc_code")) AS "gc_code",
    trim(workspace."data"->>'name') AS "name",
    (workspace."data"->>'publishedLatitude')::numeric AS "latitude",
    (workspace."data"->>'publishedLongitude')::numeric AS "longitude",
    NULLIF(trim(workspace."data"->>'country'), '') AS "country",
    NULLIF(trim(workspace."data"->>'region'), '') AS "region",
    NULLIF(trim(workspace."data"->>'county'), '') AS "county",
    workspace."updated_at",
    workspace."id"
  FROM "mystery_workspaces" AS workspace
  WHERE workspace."gc_code" IS NOT NULL
    AND upper(trim(workspace."gc_code")) ~ '^GC[A-Z0-9]+$'
    AND NULLIF(trim(workspace."data"->>'name'), '') IS NOT NULL
    AND workspace."data"->>'publishedLatitude' ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$'
    AND workspace."data"->>'publishedLongitude' ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$'
), selected AS (
  SELECT DISTINCT ON ("gc_code") *
  FROM candidates
  WHERE "latitude" BETWEEN -90 AND 90
    AND "longitude" BETWEEN -180 AND 180
  ORDER BY "gc_code", "updated_at" DESC, "id"
)
INSERT INTO "caches" (
  "id", "gc_code", "name", "latitude", "longitude", "country", "region", "county", "updated_at"
)
SELECT
  'mystery_cache_' || md5(selected."gc_code"),
  selected."gc_code",
  selected."name",
  selected."latitude",
  selected."longitude",
  selected."country",
  selected."region",
  selected."county",
  CURRENT_TIMESTAMP
FROM selected
WHERE NOT EXISTS (
  SELECT 1
  FROM "caches" AS cache
  WHERE cache."gc_code" = selected."gc_code"
);

COMMIT;
