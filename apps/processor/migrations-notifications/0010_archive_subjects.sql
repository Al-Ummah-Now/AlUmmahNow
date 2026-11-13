-- Queue-message archive pseudonyms (#1177). Expand-only: one new table.
-- One row per person whose events the processor archived: the random secret their archived
-- user ids are pseudonymised with (HMAC-SHA-256). Keyed by SHA-256 of the user id, so the table
-- holds no raw id. Account erasure clears the secret and stamps erased_at: the archived
-- pseudonyms no longer lead to anyone, and later messages about the account archive as erased.
CREATE TABLE IF NOT EXISTS archive_subjects (
  subject TEXT PRIMARY KEY,   -- hex SHA-256 of 'archive-subject:' || user id
  secret TEXT,                -- hex, 256 bits; NULL once erased
  created_at INTEGER NOT NULL,
  erased_at INTEGER           -- set by the erasure
);
