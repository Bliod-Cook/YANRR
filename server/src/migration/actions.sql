CREATE TABLE action_rules (
    user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    rules jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

-- Entries the user's rules blocked when they arrived. Kept after unsubscribing, so a resubscription keeps them hidden.
CREATE TABLE blocked_entries (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    entry_id bigint NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, entry_id)
);
