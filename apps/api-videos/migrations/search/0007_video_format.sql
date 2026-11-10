-- Short vs video (packages/shared-types/src/video-format.ts).
--
-- A Short is <= 3 minutes AND vertical or square (encoded height >= width),
-- unless the uploader chose "Upload as Short / as video" (that choice wins).
-- The rule is computed in code when a row is written; is_short stores the
-- result so channel Videos/Shorts tabs, feeds and search filter in SQL.
--
-- Expand-only: new columns default to 0 (a video), which is also what the
-- rule says for a video whose dimensions are not known yet. Existing rows get
-- their value from the format backfill job (api-videos lib/video-format,
-- queued, idempotent) and from every later write of the video.
ALTER TABLE content_ownership ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_channels ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_playlists ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_posts ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_short ON content_ownership (kind, channel_id, is_short, created_at);
CREATE INDEX IF NOT EXISTS idx_search_videos_short ON search_videos (is_short, created_at);
