CREATE TABLE "admin_activity_logs" (
  "id" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_activity_logs_created_at_idx"
  ON "admin_activity_logs"("created_at");
CREATE INDEX "admin_activity_logs_admin_id_created_at_idx"
  ON "admin_activity_logs"("admin_id", "created_at");

ALTER TABLE "admin_activity_logs"
  ADD CONSTRAINT "admin_activity_logs_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
