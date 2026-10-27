-- Lets the timeline walk entries in its own order, `published_at DESC, id DESC`, and stop at the page limit
-- instead of sorting every subscribed entry; the per-feed index gains `id` so single-feed pages break ties
-- from the index too.
CREATE INDEX entries_published_at_id_idx ON entries (published_at DESC, id DESC);
DROP INDEX entries_feed_id_published_at_idx;
CREATE INDEX entries_feed_id_published_at_id_idx ON entries (feed_id, published_at DESC, id DESC);
