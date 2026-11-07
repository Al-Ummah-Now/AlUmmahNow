-- Library per-user indexes (Story 29.6), in the same per-user database as notifications.
-- Written by api-videos on like/unlike and save/unsave; existing likes and
-- subscriptions are backfilled once via POST /internal/library/backfill (X-API-Key).

CREATE TABLE IF NOT EXISTS liked_videos (
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  liked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_liked_videos_user ON liked_videos(user_id, liked_at DESC, video_id);
CREATE INDEX IF NOT EXISTS idx_liked_videos_video ON liked_videos(video_id);

CREATE TABLE IF NOT EXISTS saved_posts (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  channel_id TEXT,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, saved_at DESC, post_id);
