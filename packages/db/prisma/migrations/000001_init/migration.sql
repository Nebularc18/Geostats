CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE "ImportSource" AS ENUM ('MY_FINDS_GPX', 'POCKET_QUERY', 'MANUAL_GPX', 'GEOCACHING_API');
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ImportFileType" AS ENUM ('GPX', 'ZIP');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "geocaching_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "gc_username" TEXT NOT NULL,
  "home_latitude" DECIMAL(9,6),
  "home_longitude" DECIMAL(9,6),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "geocaching_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "imports" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_type" "ImportFileType" NOT NULL,
  "source" "ImportSource" NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "object_key" TEXT NOT NULL,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "caches" (
  "id" TEXT NOT NULL,
  "gc_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cache_type" TEXT,
  "difficulty" DECIMAL(2,1),
  "terrain" DECIMAL(2,1),
  "size" TEXT,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "coordinates" geography(Point, 4326),
  "country" TEXT,
  "region" TEXT,
  "county" TEXT,
  "hidden_date" DATE,
  "owner_name" TEXT,
  "raw" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "caches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finds" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cache_id" TEXT NOT NULL,
  "import_id" TEXT,
  "found_at" TIMESTAMP(3) NOT NULL,
  "log_text" TEXT,
  "imported_from" "ImportSource" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "corrected_coordinates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cache_id" TEXT NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "corrected_coordinates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stat_snapshots" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "stats_json" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stat_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "geocaching_profiles_user_id_key" ON "geocaching_profiles"("user_id");
CREATE INDEX "imports_user_id_created_at_idx" ON "imports"("user_id", "created_at");
CREATE UNIQUE INDEX "caches_gc_code_key" ON "caches"("gc_code");
CREATE INDEX "caches_country_region_county_idx" ON "caches"("country", "region", "county");
CREATE INDEX "caches_coordinates_gix" ON "caches" USING GIST ("coordinates");
CREATE UNIQUE INDEX "finds_user_id_cache_id_found_at_key" ON "finds"("user_id", "cache_id", "found_at");
CREATE INDEX "finds_user_id_found_at_idx" ON "finds"("user_id", "found_at");
CREATE UNIQUE INDEX "corrected_coordinates_user_id_cache_id_key" ON "corrected_coordinates"("user_id", "cache_id");
CREATE INDEX "stat_snapshots_user_id_generated_at_idx" ON "stat_snapshots"("user_id", "generated_at");

ALTER TABLE "geocaching_profiles" ADD CONSTRAINT "geocaching_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finds" ADD CONSTRAINT "finds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finds" ADD CONSTRAINT "finds_cache_id_fkey" FOREIGN KEY ("cache_id") REFERENCES "caches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finds" ADD CONSTRAINT "finds_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "corrected_coordinates" ADD CONSTRAINT "corrected_coordinates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "corrected_coordinates" ADD CONSTRAINT "corrected_coordinates_cache_id_fkey" FOREIGN KEY ("cache_id") REFERENCES "caches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stat_snapshots" ADD CONSTRAINT "stat_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION set_cache_coordinates()
RETURNS trigger AS $$
BEGIN
  NEW.coordinates = ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER caches_set_coordinates
BEFORE INSERT OR UPDATE OF latitude, longitude ON "caches"
FOR EACH ROW EXECUTE FUNCTION set_cache_coordinates();
