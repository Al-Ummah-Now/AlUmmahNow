-- Notification center (Story 29.10). Database: al-ummah-now-notifications[-qa]
-- Owned by the processor (writer); api-videos reads and updates read state.
-- Texts are never stored: notification_key is a translation key, params_json fills it.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  action_url TEXT,
  actor_id TEXT,
  entity_id TEXT,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

-- Same event is stored once per recipient (retries, repeated status polls).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read);
-- 90-day retention sweep
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(created_at);

-- Per-category opt-out. A missing row means enabled.
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- Subscriber index per channel with the per-channel bell. Maintained by the
-- processor from Subscribe/Unsubscribe events; bell updated by api-videos.
CREATE TABLE IF NOT EXISTS channel_subscribers (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bell TEXT NOT NULL DEFAULT 'highlights' CHECK (bell IN ('all', 'highlights', 'none')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_subscribers_user ON channel_subscribers(user_id);
