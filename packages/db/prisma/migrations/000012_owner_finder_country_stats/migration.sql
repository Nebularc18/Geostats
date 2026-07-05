CREATE TABLE "owner_finder_country_stats" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_finder_country_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_finder_country_stats_user_id_country_key" ON "owner_finder_country_stats"("user_id", "country");
CREATE INDEX "owner_finder_country_stats_user_id_idx" ON "owner_finder_country_stats"("user_id");

ALTER TABLE "owner_finder_country_stats"
  ADD CONSTRAINT "owner_finder_country_stats_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
