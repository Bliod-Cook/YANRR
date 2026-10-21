CREATE TABLE messaging_tokens (
    user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel text NOT NULL,
    -- A device's token belongs to the last account that registered it.
    token text NOT NULL UNIQUE,
    PRIMARY KEY (user_id, channel)
);
