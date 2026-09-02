ALTER TYPE "TrackableState" ADD VALUE IF NOT EXISTS 'MISSING';

CREATE TYPE "TrackableLogType" AS ENUM ('DISCOVERED', 'RETRIEVED', 'DROPPED', 'VISITED', 'GRABBED', 'NOTE', 'MISSING');

CREATE TABLE "trackable_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "trackable_id" TEXT NOT NULL,
  "cache_id" TEXT,
  "log_type" "TrackableLogType" NOT NULL,
  "logged_at" TIMESTAMP(3) NOT NULL,
  "location_name" TEXT,
  "holder_name" TEXT,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "notes" TEXT,
  "source" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trackable_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trackable_logs_user_id_source_key_key" ON "trackable_logs"("user_id", "source_key");
CREATE INDEX "trackable_logs_user_id_trackable_id_logged_at_idx" ON "trackable_logs"("user_id", "trackable_id", "logged_at");
CREATE INDEX "trackable_logs_cache_id_idx" ON "trackable_logs"("cache_id");

ALTER TABLE "trackable_logs" ADD CONSTRAINT "trackable_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trackable_logs" ADD CONSTRAINT "trackable_logs_trackable_id_fkey"
  FOREIGN KEY ("trackable_id") REFERENCES "trackables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trackable_logs" ADD CONSTRAINT "trackable_logs_cache_id_fkey"
  FOREIGN KEY ("cache_id") REFERENCES "caches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
