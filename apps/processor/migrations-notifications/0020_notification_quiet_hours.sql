-- Quiet hours and prayer-time quiet windows per user (Epic 22, E22-D6).
-- Expand-only: one row per user who customized quiet hours; missing row = defaults (disabled).
-- During active windows, optional push notifications wait in the inbox without pushing;
-- account and safety notices always push through; no summary push afterwards; zero location stored.
CREATE TABLE IF NOT EXISTS notification_quiet_hours (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  start_minute INTEGER NOT NULL DEFAULT 1320 CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute INTEGER NOT NULL DEFAULT 360 CHECK (end_minute >= 0 AND end_minute < 1440),
  prayer_quiet_enabled INTEGER NOT NULL DEFAULT 0 CHECK (prayer_quiet_enabled IN (0, 1)),
  prayer_windows_json TEXT NOT NULL DEFAULT '[]',
  prayer_windows_updated_at INTEGER,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
