CREATE TABLE "mystery_sharing_exclusions" (
  "id" TEXT NOT NULL,
  "mystery_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mystery_sharing_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mystery_sharing_exclusions_mystery_id_recipient_id_key"
  ON "mystery_sharing_exclusions"("mystery_id", "recipient_id");
CREATE INDEX "mystery_sharing_exclusions_recipient_id_idx"
  ON "mystery_sharing_exclusions"("recipient_id");

ALTER TABLE "mystery_sharing_exclusions"
  ADD CONSTRAINT "mystery_sharing_exclusions_mystery_id_fkey"
  FOREIGN KEY ("mystery_id") REFERENCES "mystery_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mystery_sharing_exclusions"
  ADD CONSTRAINT "mystery_sharing_exclusions_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
