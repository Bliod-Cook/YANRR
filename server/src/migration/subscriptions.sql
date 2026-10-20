CREATE TABLE subscriptions (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    feed_id bigint NOT NULL REFERENCES feeds (id),
    view smallint NOT NULL,
    category text,
    title text,
    hide_from_timeline boolean,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, feed_id)
);
CREATE INDEX subscriptions_feed_id_idx ON subscriptions (feed_id);

-- Only unread entries have a row: an entry without one is read.
CREATE TABLE unreads (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    entry_id bigint NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    feed_id bigint NOT NULL,
    PRIMARY KEY (user_id, entry_id)
);
CREATE INDEX unreads_user_id_feed_id_idx ON unreads (user_id, feed_id);

CREATE TABLE collections (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    entry_id bigint NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    view smallint NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, entry_id)
);

CREATE INDEX entries_feed_id_published_at_idx ON entries (feed_id, published_at);
