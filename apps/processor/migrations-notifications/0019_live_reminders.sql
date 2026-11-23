-- Epic 17 (wiki E17 §4.3): "remind me" on a scheduled stream or premiere. Sending is made idempotent by
-- the notifications table's unique (user_id, dedupe_key), so nothing about sending is stored here.
CREATE TABLE IF NOT EXISTS live_reminders (
  stream_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (stream_id, user_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_live_reminders_user ON live_reminders (user_id, created_at, stream_id);
