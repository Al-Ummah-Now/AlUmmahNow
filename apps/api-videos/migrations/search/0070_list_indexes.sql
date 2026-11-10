-- Index-backed public lists: channel tabs, playlists, live streams, processing sweep.
--
-- content_ownership gains two kinds and one column:
--   kind 'playlist'  every playlist (playlists bucket), status 'system' for Watch later
--   kind 'stream'    every live stream (videos bucket, key livestream:<id>; row id <id>)
--   status           playlist system marker / live stream status (scheduled | live | ended | cancelled)
-- Both kinds are new, so every row of them is written with the column.
--
-- Lists page with keyset cursors on (sort key, id). The indexes cover those
-- orders, COALESCE(created_at, 0) exactly as the queries write it, so a page
-- is an index seek however deep the cursor is.
--
-- The home feed (GET /api/videos without a channel) and trending are not
-- here: they belong to discovery (migration 0068, discovery rails).
--
-- Expand-only: a new nullable column and new indexes.
ALTER TABLE content_ownership ADD COLUMN status TEXT;

-- Every playlist, newest first (GET /api/playlists)
CREATE INDEX IF NOT EXISTS idx_content_ownership_kind_created ON content_ownership (kind, COALESCE(created_at, 0), id);
-- One channel's videos (latest, oldest, popular) and playlists (latest, last changed)
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_feed ON content_ownership (kind, channel_id, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_views ON content_ownership (kind, channel_id, views, id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_updated ON content_ownership (kind, channel_id, COALESCE(updated_at, 0), id);
-- Live streams, live first then newest: one channel's, and every channel's
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_live ON content_ownership (kind, channel_id, is_live, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_live ON content_ownership (kind, is_live, COALESCE(created_at, 0), id);
-- Processing sweep: videos not ready yet, per status, resumable by id
CREATE INDEX IF NOT EXISTS idx_content_ownership_upload ON content_ownership (kind, upload_status, id);
