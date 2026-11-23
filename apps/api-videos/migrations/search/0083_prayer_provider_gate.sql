-- E21.1a: the prayer provider gate (wiki Epic 21 §3 and §5.2). Written only on a prayer-cache
-- miss: per-adapter rate window, backoff and circuit breaker, and one lease per cache key so a
-- cold key makes one upstream call. Holds no user data.
CREATE TABLE IF NOT EXISTS prayer_provider_gate (
    provider TEXT PRIMARY KEY,
    window_start_ms INTEGER NOT NULL DEFAULT 0,
    window_count INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    open_until_ms INTEGER NOT NULL DEFAULT 0,
    probe_until_ms INTEGER NOT NULL DEFAULT 0,
    next_allowed_ms INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS prayer_fetch_leases (
    cache_key TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_prayer_fetch_leases_expires ON prayer_fetch_leases (expires_at_ms);
