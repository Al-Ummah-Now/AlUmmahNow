-- Per-message deduplication for analytics counter flushes (#1921).
--
-- Written in the same D1 batch transaction as the analytics_daily upserts:
-- a redelivered queue message whose id is already present becomes a no-op,
-- while a failed flush rolls back both the counters and the dedupe markers
-- so the retry counts the message exactly once.
--
-- Rows expire after the queue's retention window (7 days; Cloudflare Queues
-- retains messages for 4 days by default) and are purged in bounded batches
-- on idx_analytics_dedupe_expires by the daily retention cron.
CREATE TABLE IF NOT EXISTS analytics_dedupe (
  message_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_analytics_dedupe_expires ON analytics_dedupe (expires_at);
