CREATE TABLE "mystery_workspace_deletions" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mystery_workspace_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mystery_workspace_deletions_owner_id_client_id_key"
  ON "mystery_workspace_deletions"("owner_id", "client_id");
CREATE INDEX "mystery_workspace_deletions_owner_id_idx"
  ON "mystery_workspace_deletions"("owner_id");

ALTER TABLE "mystery_workspace_deletions"
  ADD CONSTRAINT "mystery_workspace_deletions_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
