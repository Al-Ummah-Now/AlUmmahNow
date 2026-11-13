-- Erase tombstones (#1255). Expand-only: one new table and an index.
-- Written by the processor's account erasure (UserDataErased): the SHA-256 key of the erased
-- user id, never the id. Error ingestion (lib/errors-store.ts) checks the users of each batch
-- against it, so a report that arrives after the erasure (a page that was still open) is stored
-- anonymised. Rows expire after 30 days (processor daily cron).
CREATE TABLE IF NOT EXISTS erased_users (
  user_key TEXT PRIMARY KEY,   -- hex SHA-256 of 'erased-user:' || user id
  erased_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_erased_users_erased_at ON erased_users (erased_at);
