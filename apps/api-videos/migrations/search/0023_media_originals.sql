-- Kept originals of uploads (docs/media-delivery/ORIGINALS.md): one row per video whose upload we hold
-- in al-ummah-now-media-originals. Retention (lib/media/originals.ts sweepOriginals) and the daily cost
-- job read it. Expand-only.
CREATE TABLE IF NOT EXISTS media_originals (
  video_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_originals_due ON media_originals (deleted_at, completed_at);
