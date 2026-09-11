-- Keep map pagination invalidation in the same transaction as every writer,
-- including bulk imports, restores, admin changes, and cascading deletes.
CREATE TABLE "map_revisions" (
  "user_id" TEXT NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" BIGINT NOT NULL DEFAULT 0
);

-- Keep affected users in a transaction-local queue. It deliberately has no
-- user foreign key: a user may be deleted before the deferred flush runs.
CREATE TABLE "map_revision_changes" (
  "transaction_id" BIGINT NOT NULL,
  "user_id" TEXT NOT NULL,
  PRIMARY KEY ("transaction_id", "user_id")
);

-- One increment per affected user per transaction, rather than per imported row.
-- The deferred flush locks all affected users in the same order.
CREATE FUNCTION bump_map_revisions(affected_users TEXT[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO map_revisions (user_id, revision)
  SELECT id, 1 FROM users WHERE id = ANY(affected_users) ORDER BY id
  ON CONFLICT (user_id) DO UPDATE SET revision = map_revisions.revision + 1;
$$;

CREATE FUNCTION queue_map_revisions(affected_users TEXT[]) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO map_revision_changes (transaction_id, user_id)
  SELECT txid_current(), id FROM users WHERE id = ANY(affected_users) ORDER BY id
  ON CONFLICT DO NOTHING;
$$;

CREATE FUNCTION invalidate_user_maps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM queue_map_revisions(ARRAY(SELECT DISTINCT user_id FROM new_rows));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM queue_map_revisions(ARRAY(SELECT DISTINCT user_id FROM old_rows));
  ELSE
    PERFORM queue_map_revisions(ARRAY(
      SELECT user_id FROM old_rows UNION SELECT user_id FROM new_rows
    ));
  END IF;
  RETURN NULL;
END;
$$;

-- This is intentionally deferred until transaction commit. All map data row
-- locks are then acquired before the revision rows, so separate statements in
-- concurrent transactions cannot form a data-row/revision-row lock cycle.
-- Callers must not SET CONSTRAINTS for this trigger to IMMEDIATE mid-transaction.
CREATE FUNCTION flush_map_revision_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_users TEXT[];
  current_transaction_id BIGINT := txid_current();
BEGIN
  SELECT ARRAY_AGG(user_id ORDER BY user_id)
  INTO affected_users
  FROM map_revision_changes AS changes
  WHERE changes.transaction_id = current_transaction_id;

  IF affected_users IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM bump_map_revisions(affected_users);
  DELETE FROM map_revision_changes AS changes
  WHERE changes.transaction_id = current_transaction_id;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER map_revision_changes_flush
AFTER INSERT ON map_revision_changes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flush_map_revision_changes();

-- Transition tables let createMany/deleteMany invalidate each user only once.
-- Updates deliberately invalidate conservatively, including changes to fields
-- that are not currently displayed. This keeps future map fields safe too.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['finds', 'hides', 'imports', 'geocaching_profiles', 'corrected_coordinates'] LOOP
    EXECUTE format('CREATE TRIGGER map_revision_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_user_maps()', table_name);
    EXECUTE format('CREATE TRIGGER map_revision_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_user_maps()', table_name);
    EXECUTE format('CREATE TRIGGER map_revision_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION invalidate_user_maps()', table_name);
  END LOOP;
END;
$$;

-- Shared cache metadata can change another user's results without touching
-- their finds. Cache deletion is covered by the cascading find/hide triggers;
-- insertion has no existing find/hide references to invalidate.
CREATE FUNCTION invalidate_shared_cache_maps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_map_revisions(ARRAY(
    SELECT f.user_id FROM finds f JOIN new_rows c ON c.id = f.cache_id
    UNION SELECT h.user_id FROM hides h JOIN new_rows c ON c.id = h.cache_id
  ));
  RETURN NULL;
END;
$$;
CREATE TRIGGER map_revision_cache_update AFTER UPDATE ON caches
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION invalidate_shared_cache_maps();
