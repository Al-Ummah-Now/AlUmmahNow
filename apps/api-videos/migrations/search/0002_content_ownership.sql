-- Ownership index for videos and channels (performance: owner/channel listings)
--
-- Unlike the search tables, this table holds EVERY video and channel, including
-- private, unlisted, processing, scheduled, hidden and soft-deleted ones, so
-- "my channels", channel video lists, channel totals and channel-filtered
-- video search read O(matching rows) instead of scanning whole R2 buckets.
-- Flag columns mirror the JSON fields the endpoints filter on; responses are
-- still built from the R2 objects.
--
-- Rows are written by api-videos (inline on every R2 put/delete of the videos
-- and channels buckets, lib/search/sync.ts), the processor (SearchIndexSync
-- and moderation messages) and rebuilt by the ownership pass
-- (lib/search/ownership.ts: daily cron, POST /internal/search/ownership-backfill
-- and the on-demand self-heal). Readers only trust the table once
-- search_meta has 'ownership:complete:<kind>' (set when a full pass finishes).

CREATE TABLE IF NOT EXISTS content_ownership (
  kind TEXT NOT NULL,                       -- 'video' | 'channel'
  id TEXT NOT NULL,
  owner_id TEXT,                            -- userId of the creator
  channel_id TEXT,                          -- videos: owning channel; channels: own id
  is_public INTEGER NOT NULL DEFAULT 1,     -- videos: isPublic !== false; channels: !isPrivate
  is_hidden INTEGER NOT NULL DEFAULT 0,     -- moderation
  is_deleted INTEGER NOT NULL DEFAULT 0,    -- soft delete
  is_live INTEGER NOT NULL DEFAULT 0,
  duration REAL,                            -- seconds (videos)
  schedule_status TEXT,                     -- scheduledPublishStatus (videos)
  upload_status TEXT,                       -- uploadStatus (videos)
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,                       -- dateCreated, epoch ms
  updated_at INTEGER,                       -- dateModified, epoch ms
  indexed_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS idx_content_ownership_owner ON content_ownership (kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel ON content_ownership (kind, channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_content_ownership_indexed ON content_ownership (kind, indexed_at);
