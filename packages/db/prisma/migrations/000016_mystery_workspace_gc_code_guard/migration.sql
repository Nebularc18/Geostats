ALTER TABLE "mystery_workspaces"
  ADD COLUMN "gc_code" TEXT;

UPDATE "mystery_workspaces"
SET "gc_code" = UPPER(BTRIM("data" ->> 'gcCode'))
WHERE BTRIM("data" ->> 'gcCode') ~* '^GC[A-Z0-9]+$';

CREATE TEMP TABLE "_mystery_workspace_dedup" AS
SELECT
  "id",
  FIRST_VALUE("id") OVER (
    PARTITION BY "owner_id", "gc_code"
    ORDER BY
      (SELECT COUNT(*) FROM "mystery_shares" WHERE "mystery_id" = "mystery_workspaces"."id") DESC,
      "updated_at" DESC,
      "id"
  ) AS "keeper_id"
FROM "mystery_workspaces"
WHERE "gc_code" IS NOT NULL;

DELETE FROM "mystery_shares" AS duplicate_share
USING "_mystery_workspace_dedup" AS duplicate_workspace
WHERE duplicate_workspace."id" <> duplicate_workspace."keeper_id"
  AND duplicate_share."mystery_id" = duplicate_workspace."id"
  AND EXISTS (
    SELECT 1
    FROM "mystery_shares" AS keeper_share
    WHERE keeper_share."mystery_id" = duplicate_workspace."keeper_id"
      AND keeper_share."recipient_id" = duplicate_share."recipient_id"
  );

UPDATE "mystery_shares" AS share
SET "mystery_id" = duplicate_workspace."keeper_id"
FROM "_mystery_workspace_dedup" AS duplicate_workspace
WHERE duplicate_workspace."id" <> duplicate_workspace."keeper_id"
  AND share."mystery_id" = duplicate_workspace."id";

DELETE FROM "mystery_workspaces" AS workspace
USING "_mystery_workspace_dedup" AS duplicate_workspace
WHERE workspace."id" = duplicate_workspace."id"
  AND duplicate_workspace."id" <> duplicate_workspace."keeper_id";

DROP TABLE "_mystery_workspace_dedup";

CREATE UNIQUE INDEX "mystery_workspaces_owner_id_gc_code_key"
  ON "mystery_workspaces"("owner_id", "gc_code");
