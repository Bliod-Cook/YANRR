CREATE TABLE feeds (
    id bigint PRIMARY KEY,
    url text NOT NULL UNIQUE,
    title text,
    description text,
    image text,
    site_url text,
    language text,
    ttl integer,
    etag_header text,
    last_modified_header text,
    checked_at timestamptz NOT NULL,
    refresh_enqueued_at timestamptz,
    error_message text,
    error_at timestamptz,
    migrate_to bigint REFERENCES feeds (id)
);

CREATE TABLE entries (
    id bigint PRIMARY KEY,
    feed_id bigint NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
    guid text NOT NULL,
    title text,
    url text,
    description text,
    content text,
    author text,
    author_url text,
    author_avatar text,
    categories text[],
    media jsonb,
    attachments jsonb,
    extra jsonb,
    language text,
    published_at timestamptz NOT NULL,
    inserted_at timestamptz NOT NULL,
    UNIQUE (feed_id, guid)
);
