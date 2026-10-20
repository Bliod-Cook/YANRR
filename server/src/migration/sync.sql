CREATE TABLE sync_actions (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    model text NOT NULL,
    model_id text,
    action text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sync_actions_user_id_id_idx ON sync_actions (user_id, id);

-- Highest id the cleaner deleted; cursors below it are answered with `reset`.
CREATE TABLE sync_horizon (pruned_through bigint NOT NULL);
INSERT INTO sync_horizon VALUES (0);

CREATE TABLE settings (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tab text NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, tab)
);
