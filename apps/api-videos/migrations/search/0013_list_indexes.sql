-- Index-backed public lists (home feed, channel tabs, playlists, live, trending).
--
-- content_ownership gains two kinds and two columns:
--   kind 'playlist'  every playlist (playlists bucket), status 'system' for Watch later
--   kind 'stream'    every live stream (videos bucket, key livestream:<id>; row id <id>)
--   video_category   video category (home feed category filter); not `category`:
--                    QA's database has that column from a Studio preview migration
--   status           live stream status (scheduled | live | ended | cancelled)
-- Rows get the columns from every later write and from the ownership pass
-- (admin_cols < 2 until then: readers of the new columns wait for the pass,
-- see api-videos lib/search/ownership.ts columnsCurrent).
--
-- Lists page with keyset cursors on (sort key, id). The indexes cover those
-- orders, COALESCE(created_at, 0) exactly as the queries write it, so a page
-- is an index seek however deep the cursor is.
--
-- search_videos gains activity_at: when the view counter last raised the
-- video's views (websocket-server view-counter.ts). Trending scores the
-- recently active videos with the newest and the most viewed.
--
-- Expand-only: new nullable columns and new indexes.
ALTER TABLE content_ownership ADD COLUMN video_category TEXT;
ALTER TABLE content_ownership ADD COLUMN status TEXT;
ALTER TABLE search_videos ADD COLUMN activity_at INTEGER;

-- Home feed (all channels): latest/oldest, popular, by category
CREATE INDEX IF NOT EXISTS idx_content_ownership_feed ON content_ownership (kind, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_feed_views ON content_ownership (kind, views, id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_feed_category ON content_ownership (kind, video_category, COALESCE(created_at, 0), id);
-- One channel's videos, playlists and streams
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_feed ON content_ownership (kind, channel_id, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_views ON content_ownership (kind, channel_id, views, id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_updated ON content_ownership (kind, channel_id, COALESCE(updated_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_live ON content_ownership (kind, channel_id, is_live, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_live ON content_ownership (kind, is_live, COALESCE(created_at, 0), id);
-- Processing sweep: videos not ready yet, per status, resumable by id
CREATE INDEX IF NOT EXISTS idx_content_ownership_upload ON content_ownership (kind, upload_status, id);

-- Trending candidates
CREATE INDEX IF NOT EXISTS idx_search_videos_views ON search_videos (visible, views);
CREATE INDEX IF NOT EXISTS idx_search_videos_activity ON search_videos (visible, activity_at);
