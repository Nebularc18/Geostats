-- Add missing cacheId indexes for efficient joins/cascades
CREATE INDEX IF NOT EXISTS "finds_cache_id_idx" ON "finds"("cache_id");
CREATE INDEX IF NOT EXISTS "hides_cache_id_idx" ON "hides"("cache_id");
CREATE INDEX IF NOT EXISTS "corrected_coordinates_cache_id_idx" ON "corrected_coordinates"("cache_id");
