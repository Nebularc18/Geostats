CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" ("expires_at");

ALTER TABLE "pending_object_deletions"
  ADD COLUMN "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "pending_object_deletions_available_at_idx" ON "pending_object_deletions" ("available_at");
