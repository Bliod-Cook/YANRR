-- The tables of better-auth, as its entities in `auth/schema.rs` read them.
CREATE TABLE users (
    id varchar PRIMARY KEY,
    name varchar,
    email varchar,
    email_verified boolean NOT NULL,
    image varchar,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE sessions (
    id varchar PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    token varchar NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    ip_address varchar,
    user_agent varchar,
    user_id varchar NOT NULL,
    active boolean NOT NULL,
    CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE accounts (
    id varchar PRIMARY KEY,
    account_id varchar NOT NULL,
    provider_id varchar NOT NULL,
    user_id varchar NOT NULL,
    access_token varchar,
    refresh_token varchar,
    id_token varchar,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope varchar,
    password varchar,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT fk_accounts_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE verifications (
    id varchar PRIMARY KEY,
    identifier varchar NOT NULL,
    value varchar NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX idx_users_email ON users (email);
CREATE UNIQUE INDEX idx_sessions_token ON sessions (token);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
CREATE UNIQUE INDEX idx_accounts_provider_id_account_id ON accounts (provider_id, account_id);
CREATE INDEX idx_accounts_user_id ON accounts (user_id);
CREATE INDEX idx_verifications_identifier ON verifications (identifier);

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
