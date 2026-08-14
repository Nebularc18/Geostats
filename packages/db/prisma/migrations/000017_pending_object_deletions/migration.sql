CREATE TABLE "pending_object_deletions" (
  "id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pending_object_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_object_deletions_object_key_key"
  ON "pending_object_deletions"("object_key");

CREATE INDEX "pending_object_deletions_created_at_idx"
  ON "pending_object_deletions"("created_at");
