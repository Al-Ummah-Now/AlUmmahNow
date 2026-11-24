-- Per-message deduplication for analytics counter flushes (#1921).
--
-- Written in the same D1 batch transaction as the analytics_daily upserts:
-- a redelivered queue message whose id is already present becomes a no-op,
-- while a failed flush rolls back both the counters and the dedupe markers
-- so the retry counts the message exactly once.
--
-- Keyed by (day_bucket, message_id) WITHOUT ROWID with no secondary index:
-- 1 row written on insert and 1 row written on purge delete (2 total per
-- message instead of 4 with an expires_at index). The hourly retention cron
-- deletes expired day buckets in bounded 1,000-row chunks on the primary key.
CREATE TABLE IF NOT EXISTS analytics_dedupe (
  day_bucket TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
  message_id TEXT NOT NULL,
  PRIMARY KEY (day_bucket, message_id)
) WITHOUT ROWID;
