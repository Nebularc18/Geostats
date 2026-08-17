CREATE TABLE "mystery_sharing_preferences" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "statuses" TEXT[] NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mystery_sharing_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mystery_sharing_preferences_owner_id_recipient_id_key"
  ON "mystery_sharing_preferences"("owner_id", "recipient_id");
CREATE INDEX "mystery_sharing_preferences_recipient_id_idx"
  ON "mystery_sharing_preferences"("recipient_id");

ALTER TABLE "mystery_sharing_preferences"
  ADD CONSTRAINT "mystery_sharing_preferences_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mystery_sharing_preferences"
  ADD CONSTRAINT "mystery_sharing_preferences_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
