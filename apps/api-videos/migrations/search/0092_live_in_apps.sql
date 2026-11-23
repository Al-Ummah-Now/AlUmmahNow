-- Epic 17, live in the apps (wiki E17). Expand only.
-- 1. Tier capabilities: NULL = the same as the tier's `live`.
ALTER TABLE creator_tiers ADD COLUMN live_chat INTEGER;
ALTER TABLE creator_tiers ADD COLUMN live_premieres INTEGER;
ALTER TABLE creator_tiers ADD COLUMN live_events INTEGER;

-- 2. The one upcoming model (shared with Epic 22's events calendar): a projection of R2 livestream:<id>,
--    written beside the stream's content_ownership row with the same order guard (source_version, tombstones).
--    reminder_count, heads_up_for and purge_pending belong to D1 and are never projected.
CREATE TABLE IF NOT EXISTS live_stream_metadata (
  stream_id TEXT PRIMARY KEY,
  channel_id TEXT,
  owner_id TEXT,
  kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live', 'premiere')),
  premiere_video_id TEXT,
  event_type TEXT CHECK (event_type IS NULL OR event_type IN ('jumuah', 'taraweeh', 'conference', 'halqa')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private', 'hidden', 'deleted')),
  made_for_kids INTEGER NOT NULL DEFAULT 0,
  -- the recording is held or rejected by review (VR9): the stream is its team's only
  recording_withheld INTEGER NOT NULL DEFAULT 0,
  allow_chat INTEGER NOT NULL DEFAULT 1,
  chat_replay INTEGER NOT NULL DEFAULT 1,
  slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
  subscribers_only INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  scheduled_start_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  source_version INTEGER NOT NULL DEFAULT 0,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  heads_up_for INTEGER,
  purge_pending INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_live_stream_meta_status_sched ON live_stream_metadata (status, scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_live_stream_meta_event_status ON live_stream_metadata (event_type, status, scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_live_stream_meta_channel_status ON live_stream_metadata (channel_id, status, scheduled_start_at);
-- The premiere cron: due and running premieres only, however many old streams there are
CREATE INDEX IF NOT EXISTS idx_live_stream_meta_premiere_due ON live_stream_metadata (status, scheduled_start_at) WHERE kind = 'premiere';
CREATE INDEX IF NOT EXISTS idx_live_stream_meta_premiere ON live_stream_metadata (premiere_video_id) WHERE premiere_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_stream_meta_purge ON live_stream_metadata (stream_id) WHERE purge_pending = 1;

-- Existing streams, as content_ownership knows them (kind 'stream' is the primary key's first column).
-- source_version 0: the first real write wins. scheduled_start_at is filled by the stream index rebuild
-- the hourly cron queues once (lib/live/metadata.ts).
INSERT OR IGNORE INTO live_stream_metadata (stream_id, channel_id, owner_id, status, visibility, created_at, updated_at)
SELECT id, channel_id, owner_id,
  CASE WHEN status IN ('scheduled', 'live', 'ended', 'cancelled') THEN status ELSE 'scheduled' END,
  CASE WHEN is_deleted = 1 THEN 'deleted' WHEN is_hidden = 1 THEN 'hidden' WHEN is_public = 0 THEN 'private' ELSE 'public' END,
  COALESCE(created_at, 0), COALESCE(updated_at, created_at, 0)
FROM content_ownership WHERE kind = 'stream';

-- 3. Live chat, kept beside the recording (decision E17-D1). Never stored in the R2 stream record.
CREATE TABLE IF NOT EXISTS live_chat_messages (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  author_channel_id TEXT,
  author_name TEXT NOT NULL,
  author_handle TEXT,
  author_avatar TEXT,
  author_role TEXT CHECK (author_role IS NULL OR author_role IN ('owner', 'moderator')),
  text TEXT NOT NULL,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'held', 'removed')),
  held_by TEXT CHECK (held_by IS NULL OR held_by IN ('channel_block', 'moderation')),
  removed_by TEXT CHECK (removed_by IS NULL OR removed_by IN ('author', 'moderator', 'admin')),
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Latest page, afterId, before
CREATE INDEX IF NOT EXISTS idx_live_chat_stream_created ON live_chat_messages (stream_id, status, created_at, id);
-- Replay beside the recording
CREATE INDEX IF NOT EXISTS idx_live_chat_stream_offset ON live_chat_messages (stream_id, status, offset_ms, id);
-- Cooldown, duplicates, a blocked author's own messages
CREATE INDEX IF NOT EXISTS idx_live_chat_stream_user ON live_chat_messages (stream_id, user_id, created_at);
-- Takeout and account erasure
CREATE INDEX IF NOT EXISTS idx_live_chat_user_created ON live_chat_messages (user_id, created_at, id);
-- 30-day purge of held and removed messages
CREATE INDEX IF NOT EXISTS idx_live_chat_purge ON live_chat_messages (status, updated_at) WHERE status IN ('held', 'removed');
CREATE INDEX IF NOT EXISTS idx_live_chat_pinned ON live_chat_messages (stream_id) WHERE is_pinned = 1;
