-- Channel subscriptions (docs/architecture/SCALABILITY-AUDIT.md, AV-4).
--
-- Replaces the `subscriptions[]` array embedded in each channel JSON in R2
-- (and the `subscribedTo[]` reverse index in each profile), which every
-- subscriber read-modify-wrote, so concurrent subscribes dropped each other.
-- Written only by api-videos, with atomic statements batched in one
-- transaction:
--   subscribe:   INSERT OR IGNORE a row, then +1 on the count only if it was inserted
--   unsubscribe: DELETE the row, then -1 on the count only if it was deleted

-- One row per (subscribed-to channel, subscriber channel). A member subscribes
-- as one of their channels (the channelId header), like the legacy array.
CREATE TABLE IF NOT EXISTS channel_subscriptions (
  channel_id TEXT NOT NULL,             -- the subscribed-to channel
  subscriber_channel_id TEXT NOT NULL,  -- the subscriber's channel
  user_id TEXT NOT NULL,                -- the subscriber's account
  id TEXT NOT NULL,                     -- subscription id (sent in queue events)
  created_at INTEGER NOT NULL,          -- epoch ms
  PRIMARY KEY (channel_id, subscriber_channel_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_user ON channel_subscriptions(user_id, created_at);

-- Subscriber count per channel, kept in step with channel_subscriptions in the
-- same transaction as every insert/delete (no COUNT(*) over a big channel on read).
CREATE TABLE IF NOT EXISTS channel_subscriber_counts (
  channel_id TEXT PRIMARY KEY,
  subscribers INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Channels whose legacy R2 `subscriptions[]` has been copied into
-- channel_subscriptions. The marker commits in the same transaction as the
-- copy, so a channel is imported at most once; from then on the R2 array is
-- ignored. Channels without a marker are read from R2 (no subscription can
-- have changed there since: every subscribe/unsubscribe imports first).
CREATE TABLE IF NOT EXISTS channel_subscription_imports (
  channel_id TEXT PRIMARY KEY,
  legacy_count INTEGER NOT NULL,        -- entries in the R2 array at import time
  imported_at INTEGER NOT NULL          -- epoch ms
) WITHOUT ROWID;

-- Progress of the hourly api-videos cron that imports every channel (one row).
-- It resumes from `cursor` (R2 list cursor of the channels bucket); at the end
-- of a pass it records `completed_at` and starts over, so channels created
-- later are imported too.
CREATE TABLE IF NOT EXISTS channel_subscription_import_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT,
  passes INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,                 -- epoch ms of the last finished pass
  updated_at INTEGER NOT NULL
);
