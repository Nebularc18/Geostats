-- Private cache metadata contributes coordinates, filters, and labels to maps.
-- Use the same transaction-local deferred queue as every other map writer.
CREATE TRIGGER map_revision_insert AFTER INSERT ON user_cache_data
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION invalidate_user_maps();

CREATE TRIGGER map_revision_update AFTER UPDATE ON user_cache_data
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
EXECUTE FUNCTION invalidate_user_maps();

CREATE TRIGGER map_revision_delete AFTER DELETE ON user_cache_data
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
EXECUTE FUNCTION invalidate_user_maps();
