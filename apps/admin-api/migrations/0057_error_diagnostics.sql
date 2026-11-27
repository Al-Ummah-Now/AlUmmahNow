-- Opt-in scrubbed diagnostic log bundles stored in R2 (bucket DIAGNOSTICS, 30-day lifecycle expiry).
-- Keyed by error reference (ERR-XXXX-XXXX) so uploads work whether they arrive before or after
-- async ERRORS_QUEUE ingest, and for standalone user-triggered diagnostic uploads.
CREATE TABLE IF NOT EXISTS error_diagnostics (
    ref TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    environment TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    content_encoding TEXT NOT NULL DEFAULT 'gzip',
    size_bytes INTEGER NOT NULL,
    stored_bytes INTEGER NOT NULL,
    entry_count INTEGER NOT NULL DEFAULT 0,
    release TEXT,
    user_id TEXT,
    child_safety INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_diagnostics_created ON error_diagnostics (created_at);

-- Persist the original owner of each ref on error_refs (INSERT OR IGNORE) so diagnostic
-- upload ownership holds even when an event is unsampled or a second account submits a
-- duplicate event with the same ref.
ALTER TABLE error_refs ADD COLUMN user_id TEXT;

-- Backfill pre-existing sampled refs from their canonical linked error_events row
-- (excluding the ERASED_USER_ID tombstone 'deleted-user').
UPDATE error_refs
SET user_id = (
    SELECT e.user_id
    FROM error_events e
    WHERE e.id = error_refs.event_id
      AND e.user_id IS NOT NULL
      AND e.user_id <> 'deleted-user'
)
WHERE event_id IS NOT NULL AND user_id IS NULL;
