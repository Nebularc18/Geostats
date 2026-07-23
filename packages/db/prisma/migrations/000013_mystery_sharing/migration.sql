CREATE TABLE "mystery_workspaces" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mystery_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mystery_shares" (
  "id" TEXT NOT NULL,
  "mystery_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mystery_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mystery_workspaces_owner_id_client_id_key" ON "mystery_workspaces"("owner_id", "client_id");
CREATE INDEX "mystery_workspaces_owner_id_idx" ON "mystery_workspaces"("owner_id");
CREATE UNIQUE INDEX "mystery_shares_mystery_id_recipient_id_key" ON "mystery_shares"("mystery_id", "recipient_id");
CREATE INDEX "mystery_shares_recipient_id_created_at_idx" ON "mystery_shares"("recipient_id", "created_at");

ALTER TABLE "mystery_workspaces"
  ADD CONSTRAINT "mystery_workspaces_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mystery_shares"
  ADD CONSTRAINT "mystery_shares_mystery_id_fkey"
  FOREIGN KEY ("mystery_id") REFERENCES "mystery_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mystery_shares"
  ADD CONSTRAINT "mystery_shares_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
