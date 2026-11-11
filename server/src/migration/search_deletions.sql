-- Deleted entries, with their inbox or user too, are queued for the search index, which drops what it has of
-- entries that are gone.
CREATE FUNCTION queue_deleted_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO search_queue SELECT id FROM deleted ON CONFLICT DO NOTHING;
    RETURN NULL;
END
$$;

CREATE TRIGGER entries_search_queue
    AFTER DELETE ON entries
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION queue_deleted_entries();

CREATE TRIGGER inbox_entries_search_queue
    AFTER DELETE ON inbox_entries
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION queue_deleted_entries();
