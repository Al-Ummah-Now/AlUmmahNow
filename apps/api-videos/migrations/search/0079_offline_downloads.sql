-- Epic 14: Offline downloads & Listen mode (wiki E14).
-- 1) Admin-managed tier download rules on creator_tiers (T1).
-- 2) Device-bound download_licenses table with indexed lookups only (no table scans).

ALTER TABLE creator_tiers ADD COLUMN offline_downloads INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creator_tiers ADD COLUMN offline_max_quality TEXT NOT NULL DEFAULT '480p';
ALTER TABLE creator_tiers ADD COLUMN offline_max_videos INTEGER DEFAULT 25;
ALTER TABLE creator_tiers ADD COLUMN offline_license_days INTEGER NOT NULL DEFAULT 30;

UPDATE creator_tiers SET offline_max_quality = '1080p', offline_max_videos = 100 WHERE id = 'creator';
UPDATE creator_tiers SET offline_max_quality = '1080p', offline_max_videos = NULL WHERE id = 'unlimited';

CREATE TABLE IF NOT EXISTS download_licenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  quality TEXT NOT NULL,
  audio_track_id TEXT,
  r2_rev TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revoked_reason TEXT,
  issued_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(user_id, device_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_download_licenses_user_status
  ON download_licenses (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_download_licenses_user_device
  ON download_licenses (user_id, device_id, status);

CREATE INDEX IF NOT EXISTS idx_download_licenses_video_status
  ON download_licenses (video_id, status);
