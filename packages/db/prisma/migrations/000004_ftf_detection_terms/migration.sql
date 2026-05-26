ALTER TABLE "geocaching_profiles"
  ADD COLUMN "ftf_detection_terms" TEXT[] NOT NULL DEFAULT ARRAY['FTF', 'first to find'];
