-- The handle is the local part of the inbox's email address, so it is unique across users.
CREATE TABLE inboxes (
    handle text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title text,
    -- Authorizes webhook deliveries.
    secret text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    created_at timestamptz NOT NULL
);
CREATE INDEX inboxes_user_id_idx ON inboxes (user_id);

-- Ids share the snowflake space of entries.
CREATE TABLE inbox_entries (
    id bigint PRIMARY KEY,
    inbox_handle text NOT NULL REFERENCES inboxes (handle) ON DELETE CASCADE,
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
    read boolean NOT NULL,
    published_at timestamptz NOT NULL,
    inserted_at timestamptz NOT NULL,
    UNIQUE (inbox_handle, guid)
);
CREATE INDEX inbox_entries_inbox_handle_published_at_idx ON inbox_entries (inbox_handle, published_at);
