ALTER TABLE "imports"
  ADD COLUMN "object_size_bytes" INTEGER,
  ADD COLUMN "object_cleanup_attempted_at" TIMESTAMP(3);

CREATE INDEX "imports_object_cleanup_attempted_at_updated_at_idx"
  ON "imports"("object_cleanup_attempted_at", "updated_at");
