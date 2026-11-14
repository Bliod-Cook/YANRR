-- Entries moved to another feed while being indexed could stay in the search index under the feed they left; those
-- of every feed others migrated to are indexed again.
INSERT INTO search_queue
SELECT id FROM entries WHERE feed_id IN (SELECT migrate_to FROM feeds WHERE migrate_to IS NOT NULL)
ON CONFLICT DO NOTHING;
