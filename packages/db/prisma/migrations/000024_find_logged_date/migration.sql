ALTER TABLE "finds" ADD COLUMN "found_date" DATE;

UPDATE "finds" AS find
SET "found_date" = (
  (find."found_at" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(
    (SELECT profile."time_zone" FROM "geocaching_profiles" AS profile WHERE profile."user_id" = find."user_id"),
    'Europe/Stockholm'
  )
)::date;

ALTER TABLE "finds" ALTER COLUMN "found_date" SET NOT NULL;
