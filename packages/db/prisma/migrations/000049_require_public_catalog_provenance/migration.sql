BEGIN;

ALTER TABLE "caches" ADD COLUMN "public_listing_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- Earlier enrichment did not retain access restrictions. Keep shared cache
-- identities and personal imports, and require public provenance to enrich again.
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
    "metadata_trusted" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "metadata_trusted";

UPDATE "stat_snapshots" SET "server_generated" = false WHERE "server_generated";

-- The previous admin macro sent private and restricted fields before the API
-- could inspect them. Reissue its credentials only with the updated macro.
DELETE FROM "collector_tokens" WHERE "scope" = 'GSAK_ADMIN_IMPORT';

ALTER TABLE "caches" ADD CONSTRAINT "shared_cache_requires_public_listing"
  CHECK (NOT "metadata_trusted" OR "public_listing_confirmed");

COMMIT;
