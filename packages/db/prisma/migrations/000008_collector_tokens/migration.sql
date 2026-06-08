CREATE TABLE "collector_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collector_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collector_tokens_token_hash_key" ON "collector_tokens"("token_hash");
CREATE INDEX "collector_tokens_user_id_created_at_idx" ON "collector_tokens"("user_id", "created_at");

ALTER TABLE "collector_tokens"
  ADD CONSTRAINT "collector_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
