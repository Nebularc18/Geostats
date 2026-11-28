ALTER TABLE "geocaching_profiles"
  ADD COLUMN "legacy_public_stats_username" TEXT,
  ADD COLUMN "friend_stats_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Keep existing public links only when their owner can be identified uniquely.
-- Only this migration writes legacy aliases. Future links use the profile ID.
WITH normalized AS (
  SELECT "id", "public_stats_enabled",
    lower(regexp_replace("gc_username",
      U&'^[[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+|[[:space:]\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+$', '', 'g')) AS username
  FROM "geocaching_profiles"
), unique_names AS (
  SELECT username FROM normalized WHERE username <> '' GROUP BY username HAVING count(*) = 1
)
UPDATE "geocaching_profiles" p
SET "legacy_public_stats_username" = n.username
FROM normalized n JOIN unique_names u ON u.username = n.username
WHERE p."id" = n."id" AND n."public_stats_enabled";

CREATE UNIQUE INDEX "geocaching_profiles_legacy_public_stats_username_key"
ON "geocaching_profiles"("legacy_public_stats_username");
