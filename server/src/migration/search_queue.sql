-- Feed and inbox entries stored but not yet in the search index, queued in the transaction storing them.
CREATE TABLE search_queue (entry_id bigint PRIMARY KEY);
