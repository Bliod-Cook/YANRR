-- A token per device rather than per account and channel, so that devices of one account and platform coexist; a
-- device's token still belongs to the last account that registered it.
ALTER TABLE messaging_tokens DROP CONSTRAINT messaging_tokens_pkey;
ALTER TABLE messaging_tokens DROP CONSTRAINT messaging_tokens_token_key;
ALTER TABLE messaging_tokens ADD PRIMARY KEY (token);
CREATE INDEX messaging_tokens_user_id_idx ON messaging_tokens (user_id);
