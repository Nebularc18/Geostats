-- Unify cache-type spellings stored by different import paths.
--
-- Groundspeak GPX stores full names ("Unknown Cache") while the GSAK
-- connector stores short display names ("Mystery"). New writes go through
-- canonicalCacheTypeName() in @geostats/shared so every path stores one
-- canonical label; this backfills rows written before that. Matching stays
-- alias-tolerant at read time, so this is a storage tidy-up, not a fixup.
-- Comparisons are case-insensitive, mirroring the catalog normalization.

UPDATE "caches" SET "cache_type" = 'Traditional Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('traditional')
  AND "cache_type" <> 'Traditional Cache';

UPDATE "caches" SET "cache_type" = 'Multi-Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('multi-cache', 'multi cache', 'multi')
  AND "cache_type" <> 'Multi-Cache';

UPDATE "caches" SET "cache_type" = 'Virtual Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('virtual')
  AND "cache_type" <> 'Virtual Cache';

UPDATE "caches" SET "cache_type" = 'Letterbox Hybrid'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('letterbox')
  AND "cache_type" <> 'Letterbox Hybrid';

UPDATE "caches" SET "cache_type" = 'Event Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('event')
  AND "cache_type" <> 'Event Cache';

UPDATE "caches" SET "cache_type" = 'Mystery Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('mystery', 'unknown', 'puzzle', 'puzzle cache', 'unknown cache', 'unknown (mystery) cache', 'mystery/unknown cache', 'mystery or puzzle cache', 'mystery/puzzle cache')
  AND "cache_type" <> 'Mystery Cache';

UPDATE "caches" SET "cache_type" = 'Project A.P.E. Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('project ape', 'project a.p.e. cache')
  AND "cache_type" <> 'Project A.P.E. Cache';

UPDATE "caches" SET "cache_type" = 'Webcam Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('webcam')
  AND "cache_type" <> 'Webcam Cache';

UPDATE "caches" SET "cache_type" = 'Locationless Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('locationless (reverse) cache', 'locationless')
  AND "cache_type" <> 'Locationless Cache';

UPDATE "caches" SET "cache_type" = 'Cache In Trash Out Event'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('cito event', 'cito')
  AND "cache_type" <> 'Cache In Trash Out Event';

UPDATE "caches" SET "cache_type" = 'EarthCache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('earth', 'earth cache', 'earthcache')
  AND "cache_type" <> 'EarthCache';

UPDATE "caches" SET "cache_type" = 'Mega-Event Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('mega event cache', 'mega-event', 'mega event')
  AND "cache_type" <> 'Mega-Event Cache';

UPDATE "caches" SET "cache_type" = 'GPS Adventures Maze Exhibit'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('gps adventures exhibit', 'gps maze exhibit', 'maze exhibit')
  AND "cache_type" <> 'GPS Adventures Maze Exhibit';

UPDATE "caches" SET "cache_type" = 'Wherigo Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('wherigo')
  AND "cache_type" <> 'Wherigo Cache';

UPDATE "caches" SET "cache_type" = 'Community Celebration Event'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('community celebration', 'l&f event', 'l and f event', 'lost and found event cache', 'lost and found event')
  AND "cache_type" <> 'Community Celebration Event';

UPDATE "caches" SET "cache_type" = 'Geocaching HQ Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('groundspeak hq', 'groundspeak hq cache', 'geocaching hq', 'hq', 'hq cache')
  AND "cache_type" <> 'Geocaching HQ Cache';

UPDATE "caches" SET "cache_type" = 'Geocaching HQ Celebration'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('l&f celebration', 'l and f celebration', 'hq celebration', 'groundspeak lost and found celebration', 'lost and found celebration')
  AND "cache_type" <> 'Geocaching HQ Celebration';

UPDATE "caches" SET "cache_type" = 'Geocaching HQ Block Party'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('groundspeak block party', 'block party')
  AND "cache_type" <> 'Geocaching HQ Block Party';

UPDATE "caches" SET "cache_type" = 'Giga-Event Cache'
WHERE "cache_type" IS NOT NULL
  AND lower(trim("cache_type")) IN ('giga event cache', 'giga-event', 'giga event')
  AND "cache_type" <> 'Giga-Event Cache';
