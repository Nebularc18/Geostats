CREATE TYPE "TrackableState" AS ENUM ('OWNED', 'DISCOVERED', 'RETRIEVED', 'DROPPED', 'VISITED');

CREATE TABLE "trackables" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tracking_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "state" "TrackableState" NOT NULL DEFAULT 'DISCOVERED',
  "last_seen_at" DATE,
  "last_seen_location" TEXT,
  "distance_km" DECIMAL(10,2),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trackables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trackables_user_id_tracking_code_key" ON "trackables"("user_id", "tracking_code");
CREATE INDEX "trackables_user_id_state_idx" ON "trackables"("user_id", "state");
CREATE INDEX "trackables_user_id_last_seen_at_idx" ON "trackables"("user_id", "last_seen_at");

ALTER TABLE "trackables" ADD CONSTRAINT "trackables_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
