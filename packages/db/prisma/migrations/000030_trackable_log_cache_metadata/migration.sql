ALTER TABLE "trackable_logs"
  ADD COLUMN "gc_code" TEXT,
  ADD COLUMN "cache_name" TEXT;

CREATE INDEX "trackable_logs_user_id_gc_code_idx"
  ON "trackable_logs"("user_id", "gc_code");
