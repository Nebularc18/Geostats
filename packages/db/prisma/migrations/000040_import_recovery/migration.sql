ALTER TABLE "imports"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "receipt" JSONB,
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "recovery_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "imports_status_updated_at_idx" ON "imports"("status", "updated_at");
