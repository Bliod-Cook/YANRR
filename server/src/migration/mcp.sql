-- Bearer tokens of the MCP server; a token itself is shown once when issued and kept only as its SHA-256.
CREATE TABLE mcp_tokens (
    id bigint PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    scopes text[] NOT NULL,
    created_at timestamptz NOT NULL,
    last_used_at timestamptz
);
CREATE INDEX mcp_tokens_user_id_idx ON mcp_tokens (user_id);

-- When each user last opened an entry in a client.
CREATE TABLE reading_history (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    entry_id bigint NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    opened_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, entry_id)
);
CREATE INDEX reading_history_user_id_opened_at_idx ON reading_history (user_id, opened_at DESC, entry_id DESC);
