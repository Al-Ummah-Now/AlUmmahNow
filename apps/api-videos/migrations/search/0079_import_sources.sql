-- Social import sources (wiki TOOLS-ADMIN TA-9). Owned by api-videos; admin-api manages them through
-- /internal/admin/import/sources (super admins, import_sources:manage); the admin job
-- 'import.source-sync' reads new items and posts them on the channel.

-- One public feed of a channel's owner, imported into that channel.
CREATE TABLE IF NOT EXISTS import_sources (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  network TEXT NOT NULL,                 -- rss | bluesky | mastodon | telegram | youtube
  address TEXT NOT NULL,                 -- feed URL, Bluesky DID, @user@instance, Telegram chat id, YouTube channel id
  label TEXT NOT NULL DEFAULT '',
  auth_kind TEXT NOT NULL,               -- connected | recorded
  social_account_id TEXT,                -- connected: the owner's social_accounts row
  yt_import_id TEXT,                     -- connected (youtube): the owner's yt_imports row
  permission_by TEXT,                    -- recorded: whose written permission
  permission_note TEXT,
  permission_at INTEGER,
  schedule TEXT NOT NULL DEFAULT 'manual', -- manual | hourly | daily | weekly
  enabled INTEGER NOT NULL DEFAULT 1,
  cursor TEXT,                           -- the network's paging point (newest item seen)
  next_sync_at INTEGER,                  -- ms; null when manual or disabled
  last_sync_at INTEGER,
  last_job_id TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (channel_id, network, address)
);
CREATE INDEX IF NOT EXISTS idx_import_sources_due ON import_sources (enabled, next_sync_at);
CREATE INDEX IF NOT EXISTS idx_import_sources_network ON import_sources (network, address);

-- One item of a source, recorded once (a re-sync skips it) with what it produced.
CREATE TABLE IF NOT EXISTS import_source_items (
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,                 -- the network's id of the post
  kind TEXT,                             -- text | image | link | video
  state TEXT NOT NULL,                   -- pending | posted | skipped | awaiting_file
  payload TEXT,                          -- JSON of the item until posted
  post_id TEXT,                          -- set before the post is written: a retry reuses it
  video_id TEXT,
  original_url TEXT,
  original_at INTEGER,                   -- ms
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_import_source_items_state ON import_source_items (source_id, state, original_at);
CREATE INDEX IF NOT EXISTS idx_import_source_items_post ON import_source_items (post_id);
CREATE INDEX IF NOT EXISTS idx_import_source_items_video ON import_source_items (video_id);
