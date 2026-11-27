-- Event-ID deduplication for native app telemetry batches (AlUmmahNowCore#8 / POST /api/telemetry/batches).
-- Rows expire after 24 hours and are pruned by the daily cron alongside rate limits.
CREATE TABLE IF NOT EXISTS telemetry_dedupe (
    event_id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_dedupe_expires ON telemetry_dedupe (expires_at);
