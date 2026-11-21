CREATE TABLE "travel_plans" (
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "id" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("user_id", "id")
);

CREATE INDEX "travel_plans_user_id_deleted_at_updated_at_idx" ON "travel_plans"("user_id", "deleted_at", "updated_at");
