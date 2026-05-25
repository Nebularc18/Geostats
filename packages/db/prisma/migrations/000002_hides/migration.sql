ALTER TYPE "ImportSource" ADD VALUE IF NOT EXISTS 'MY_HIDES_GPX';

CREATE TABLE "hides" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cache_id" TEXT NOT NULL,
  "import_id" TEXT,
  "placed_at" DATE,
  "received_log_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hides_user_id_cache_id_key" ON "hides"("user_id", "cache_id");
CREATE INDEX "hides_user_id_placed_at_idx" ON "hides"("user_id", "placed_at");

ALTER TABLE "hides" ADD CONSTRAINT "hides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hides" ADD CONSTRAINT "hides_cache_id_fkey" FOREIGN KEY ("cache_id") REFERENCES "caches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hides" ADD CONSTRAINT "hides_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
