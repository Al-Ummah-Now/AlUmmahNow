-- Event-ID deduplication for native app telemetry batches (AlUmmahNowCore#8 / POST /api/telemetry/batches).
-- In-flight claims hold a short-lived `pending` lease (`claim_token`) until delivery completes, then
-- transition to `delivered` for 24 hours. Expired rows are pruned by the daily cron alongside rate limits.
CREATE TABLE IF NOT EXISTS telemetry_dedupe (
    event_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    claim_token TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_dedupe_expires ON telemetry_dedupe (expires_at);
