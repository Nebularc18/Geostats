-- Preserve each account's legacy GPX/GSAK metadata in the same normalized
-- private JSON paths used by SQL filters. Never enrich the shared catalog.
-- Existing normalized keys win, including explicit nulls.
CREATE FUNCTION pg_temp.private_metadata_text(value JSONB) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  -- Match JavaScript String.trim(), used by personalCacheMetadata().
  SELECT NULLIF(btrim(CASE
    WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
    WHEN jsonb_typeof(value) = 'object' AND jsonb_typeof(value->'text') = 'string'
      THEN value->>'text'
    ELSE NULL END, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '')
$$;

CREATE FUNCTION pg_temp.private_metadata_number(value JSONB, minimum NUMERIC, maximum NUMERIC) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE candidate TEXT; parsed NUMERIC;
BEGIN
  candidate := CASE WHEN jsonb_typeof(value) = 'number' THEN value #>> '{}'
    ELSE pg_temp.private_metadata_text(value) END;
  IF candidate IS NULL OR length(candidate) > 64
    OR candidate !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN
    RETURN 'null'::jsonb;
  END IF;
  BEGIN
    parsed := candidate::numeric;
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RETURN 'null'::jsonb;
  END;
  IF parsed BETWEEN minimum AND maximum THEN RETURN to_jsonb(parsed); END IF;
  RETURN 'null'::jsonb;
END
$$;

CREATE FUNCTION pg_temp.normalize_private_cache_metadata(raw JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE extension JSONB; normalized JSONB; latitude JSONB; longitude JSONB;
  cache_type TEXT; hidden_date TEXT; owner_name TEXT;
BEGIN
  extension := COALESCE(NULLIF(raw->'groundspeak:cache', 'null'::jsonb),
    NULLIF(raw->'cache', 'null'::jsonb), NULLIF(raw#>'{extensions,groundspeak:cache}', 'null'::jsonb),
    NULLIF(raw#>'{extensions,cache}', 'null'::jsonb), '{}'::jsonb);
  cache_type := COALESCE(pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:type', 'null'::jsonb), extension->'type')),
    pg_temp.private_metadata_text(raw->'type'));
  SELECT label INTO cache_type FROM (VALUES
    ('2', 'Traditional Cache'),
    ('traditional cache', 'Traditional Cache'),
    ('traditional', 'Traditional Cache'),
    ('3', 'Multi-Cache'),
    ('multi cache', 'Multi-Cache'),
    ('multi', 'Multi-Cache'),
    ('4', 'Virtual Cache'),
    ('virtual cache', 'Virtual Cache'),
    ('virtual', 'Virtual Cache'),
    ('5', 'Letterbox Hybrid'),
    ('letterbox hybrid', 'Letterbox Hybrid'),
    ('letterbox', 'Letterbox Hybrid'),
    ('6', 'Event Cache'),
    ('event cache', 'Event Cache'),
    ('event', 'Event Cache'),
    ('8', 'Mystery Cache'),
    ('mystery cache', 'Mystery Cache'),
    ('mystery', 'Mystery Cache'),
    ('unknown', 'Mystery Cache'),
    ('puzzle', 'Mystery Cache'),
    ('puzzle cache', 'Mystery Cache'),
    ('unknown cache', 'Mystery Cache'),
    ('unknown mystery cache', 'Mystery Cache'),
    ('mystery unknown cache', 'Mystery Cache'),
    ('mystery or puzzle cache', 'Mystery Cache'),
    ('mystery puzzle cache', 'Mystery Cache'),
    ('9', 'Project A.P.E. Cache'),
    ('project a p e cache', 'Project A.P.E. Cache'),
    ('project ape', 'Project A.P.E. Cache'),
    ('11', 'Webcam Cache'),
    ('webcam cache', 'Webcam Cache'),
    ('webcam', 'Webcam Cache'),
    ('12', 'Locationless Cache'),
    ('locationless cache', 'Locationless Cache'),
    ('locationless reverse cache', 'Locationless Cache'),
    ('locationless', 'Locationless Cache'),
    ('13', 'Cache In Trash Out Event'),
    ('cache in trash out event', 'Cache In Trash Out Event'),
    ('cito event', 'Cache In Trash Out Event'),
    ('cito', 'Cache In Trash Out Event'),
    ('137', 'EarthCache'),
    ('earthcache', 'EarthCache'),
    ('earth', 'EarthCache'),
    ('earth cache', 'EarthCache'),
    ('453', 'Mega-Event Cache'),
    ('mega event cache', 'Mega-Event Cache'),
    ('mega event', 'Mega-Event Cache'),
    ('1304', 'GPS Adventures Maze Exhibit'),
    ('gps adventures maze exhibit', 'GPS Adventures Maze Exhibit'),
    ('gps adventures exhibit', 'GPS Adventures Maze Exhibit'),
    ('gps maze exhibit', 'GPS Adventures Maze Exhibit'),
    ('maze exhibit', 'GPS Adventures Maze Exhibit'),
    ('1858', 'Wherigo Cache'),
    ('wherigo cache', 'Wherigo Cache'),
    ('wherigo', 'Wherigo Cache'),
    ('3653', 'Community Celebration Event'),
    ('community celebration event', 'Community Celebration Event'),
    ('community celebration', 'Community Celebration Event'),
    ('l f event', 'Community Celebration Event'),
    ('l and f event', 'Community Celebration Event'),
    ('lost and found event cache', 'Community Celebration Event'),
    ('lost and found event', 'Community Celebration Event'),
    ('3773', 'Geocaching HQ Cache'),
    ('geocaching hq cache', 'Geocaching HQ Cache'),
    ('groundspeak hq', 'Geocaching HQ Cache'),
    ('groundspeak hq cache', 'Geocaching HQ Cache'),
    ('geocaching hq', 'Geocaching HQ Cache'),
    ('hq', 'Geocaching HQ Cache'),
    ('hq cache', 'Geocaching HQ Cache'),
    ('3774', 'Geocaching HQ Celebration'),
    ('geocaching hq celebration', 'Geocaching HQ Celebration'),
    ('l f celebration', 'Geocaching HQ Celebration'),
    ('l and f celebration', 'Geocaching HQ Celebration'),
    ('hq celebration', 'Geocaching HQ Celebration'),
    ('groundspeak lost and found celebration', 'Geocaching HQ Celebration'),
    ('lost and found celebration', 'Geocaching HQ Celebration'),
    ('4738', 'Geocaching HQ Block Party'),
    ('geocaching hq block party', 'Geocaching HQ Block Party'),
    ('groundspeak block party', 'Geocaching HQ Block Party'),
    ('block party', 'Geocaching HQ Block Party'),
    ('7005', 'Giga-Event Cache'),
    ('giga event cache', 'Giga-Event Cache'),
    ('giga event', 'Giga-Event Cache')
  ) AS aliases(alias, label)
  WHERE alias = btrim(regexp_replace(lower(cache_type), '[^a-z0-9]+', ' ', 'g')) LIMIT 1;
  -- Unknown type spellings remain useful and private.
  cache_type := COALESCE(cache_type, pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:type', 'null'::jsonb), extension->'type')),
    pg_temp.private_metadata_text(raw->'type'));
  latitude := pg_temp.private_metadata_number(raw->'lat', -90, 90);
  longitude := pg_temp.private_metadata_number(raw->'lon', -180, 180);
  hidden_date := pg_temp.private_metadata_text(COALESCE(NULLIF(raw->'time', 'null'::jsonb), NULLIF(extension->'groundspeak:date_hidden', 'null'::jsonb), extension->'date_hidden'));
  BEGIN
    IF hidden_date IS NOT NULL THEN
      hidden_date := to_char(hidden_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
  EXCEPTION WHEN OTHERS THEN hidden_date := NULL;
  END;
  normalized := jsonb_build_object(
    'cacheType', cache_type,
    'difficulty', pg_temp.private_metadata_number(COALESCE(NULLIF(extension->'groundspeak:difficulty', 'null'::jsonb), extension->'difficulty'), 1, 5),
    'terrain', pg_temp.private_metadata_number(COALESCE(NULLIF(extension->'groundspeak:terrain', 'null'::jsonb), extension->'terrain'), 1, 5),
    'size', pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:container', 'null'::jsonb), extension->'container')),
    'country', pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:country', 'null'::jsonb), extension->'country')),
    'region', pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:state', 'null'::jsonb), extension->'state')),
    'county', pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:county', 'null'::jsonb), extension->'county')),
    'hiddenDate', hidden_date,
    'ownerName', COALESCE(pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:owner', 'null'::jsonb), extension->'owner')),
      pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:placed_by', 'null'::jsonb), extension->'placed_by')))
  );
  IF COALESCE(pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:name', 'null'::jsonb), extension->'name')),
    pg_temp.private_metadata_text(raw->'desc')) IS NOT NULL THEN
    normalized := normalized || jsonb_build_object('name', COALESCE(
      pg_temp.private_metadata_text(COALESCE(NULLIF(extension->'groundspeak:name', 'null'::jsonb), extension->'name')), pg_temp.private_metadata_text(raw->'desc')));
  END IF;
  IF latitude <> 'null'::jsonb AND longitude <> 'null'::jsonb THEN
    normalized := normalized || jsonb_build_object('latitude', latitude, 'longitude', longitude);
  END IF;
  IF jsonb_typeof(raw->'geostatsMetadata') = 'object' THEN
    normalized := normalized || (raw->'geostatsMetadata');
  END IF;
  owner_name := pg_temp.private_metadata_text(normalized->'ownerName');
  normalized := normalized || jsonb_build_object('ownerNameNormalized', lower(owner_name));
  RETURN raw || jsonb_build_object('geostatsMetadata', normalized);
END
$$;

UPDATE user_cache_data AS personal
SET raw = pg_temp.normalize_private_cache_metadata(personal.raw)
FROM caches AS cache
WHERE cache.id = personal.cache_id AND cache.metadata_trusted = false
  AND jsonb_typeof(personal.raw) = 'object';

DROP FUNCTION pg_temp.normalize_private_cache_metadata(JSONB);
DROP FUNCTION pg_temp.private_metadata_number(JSONB, NUMERIC, NUMERIC);
DROP FUNCTION pg_temp.private_metadata_text(JSONB);
