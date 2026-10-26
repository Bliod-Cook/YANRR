CREATE TABLE action_rules (
    user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    rules jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
