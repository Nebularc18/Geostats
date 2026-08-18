CREATE TABLE "challenge_checkers" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gc_code" TEXT,
  "description" TEXT,
  "rules" JSONB NOT NULL,
  "public_slug" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "challenge_checkers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "challenge_checkers_public_slug_key" ON "challenge_checkers"("public_slug");
CREATE INDEX "challenge_checkers_user_id_updated_at_idx" ON "challenge_checkers"("user_id", "updated_at");

ALTER TABLE "challenge_checkers"
  ADD CONSTRAINT "challenge_checkers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
