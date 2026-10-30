-- What models made and what from, shared by every user: the summary of an article or the translation of a run of
-- text, keyed by the SHA-256 of that text.
CREATE TABLE ai_cache (
    kind text NOT NULL,
    language text NOT NULL,
    source_hash bytea NOT NULL,
    output text NOT NULL,
    PRIMARY KEY (kind, language, source_hash)
);
