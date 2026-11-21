-- Discovery ranking (wiki E07 "Discovery ranking"): unique qualified viewers.
-- Expand-only: a new table and one index.
--
-- One row per (UTC day, video, viewer) for views that may count toward
-- Trending and Popular: never the video's owner, staff, E2E or throwaway test
-- accounts, autoplay or crawlers. `viewer` is
-- 'u:<user id>' for members, or 'a:' + a hash of the request with a salt that
-- changes every day (api-videos lib/ranking/viewer.ts), so anonymous rows can't
-- be linked across days. Written by the processor (INSERT OR IGNORE: a viewer
-- counts once per video per day, however often the view is retried); the
-- ranking job counts them and deletes rows older than its longest window (91 days).
CREATE TABLE IF NOT EXISTS discovery_viewers (
  day TEXT NOT NULL,
  video_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  PRIMARY KEY (day, video_id, viewer)
) WITHOUT ROWID;

-- Likes per video per day for the ranking (liked_at is epoch ms).
CREATE INDEX IF NOT EXISTS idx_liked_videos_liked_at ON liked_videos (liked_at);
