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
