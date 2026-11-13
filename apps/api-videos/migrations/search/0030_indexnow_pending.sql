-- IndexNow for the videos site (wiki AUN-SEO): the watch pages whose public content changed,
-- waiting for the next ping (lib/indexnow.ts flushes them every 10 minutes, production only).
--
-- search_videos holds exactly the videos everyone may see, and its content_hash covers the
-- title, description, tags and format. So a row that appears (published, scheduled release,
-- Unlisted/Private -> Public), changes content, or disappears (deleted, made private or
-- unlisted, removed by moderation) is a watch page that changed. Triggers catch every writer
-- (api-videos, the processor for the scheduler, admin-api) without touching each one.
-- View counts, likes and the daily reconcile touch do not change content_hash: no ping.
-- Expand-only: a new table and triggers; no existing table or row changes.
CREATE TABLE IF NOT EXISTS indexnow_pending (
  video_id TEXT PRIMARY KEY,
  is_short INTEGER NOT NULL DEFAULT 0,
  queued_at REAL NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_indexnow_pending_queued ON indexnow_pending (queued_at);

CREATE TRIGGER IF NOT EXISTS indexnow_video_added AFTER INSERT ON search_videos WHEN NEW.visible = 1
BEGIN
  INSERT INTO indexnow_pending (video_id, is_short, queued_at) VALUES (NEW.id, NEW.is_short, julianday('now'))
  ON CONFLICT(video_id) DO UPDATE SET is_short = max(indexnow_pending.is_short, excluded.is_short), queued_at = excluded.queued_at;
END;

CREATE TRIGGER IF NOT EXISTS indexnow_video_changed AFTER UPDATE OF content_hash, visible, is_short ON search_videos
WHEN OLD.content_hash IS NOT NEW.content_hash OR OLD.visible IS NOT NEW.visible OR OLD.is_short IS NOT NEW.is_short
BEGIN
  INSERT INTO indexnow_pending (video_id, is_short, queued_at) VALUES (NEW.id, max(OLD.is_short, NEW.is_short), julianday('now'))
  ON CONFLICT(video_id) DO UPDATE SET is_short = max(indexnow_pending.is_short, excluded.is_short), queued_at = excluded.queued_at;
END;

CREATE TRIGGER IF NOT EXISTS indexnow_video_removed AFTER DELETE ON search_videos WHEN OLD.visible = 1
BEGIN
  INSERT INTO indexnow_pending (video_id, is_short, queued_at) VALUES (OLD.id, OLD.is_short, julianday('now'))
  ON CONFLICT(video_id) DO UPDATE SET is_short = max(indexnow_pending.is_short, excluded.is_short), queued_at = excluded.queued_at;
END;
