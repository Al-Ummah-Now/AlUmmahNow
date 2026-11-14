-- Media providers (docs/media-delivery/PROVIDERS.md).

-- Provider health: player fallbacks away from a provider, one row per provider, minute and
-- reporter. The api-videos cron counts DISTINCT reporters in the last window (one client looping
-- over many videos counts once) and probes each provider (lib/media/health.ts); rows older than a
-- day are deleted hourly. reporter is a daily-salted hash of the client, never an IP or user id.
CREATE TABLE IF NOT EXISTS media_provider_health (
  provider TEXT NOT NULL,
  -- YYYY-MM-DDTHH:MM (UTC)
  minute TEXT NOT NULL,
  reporter TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, minute, reporter)
);

-- Provider-side ids of videos: our video id ↔ the id a provider gave its copy (a Bunny GUID).
-- Videos uploaded before providers existed have no row: their id is their Bunny GUID, read in
-- code (lib/media/providers/bunny.ts). One provider-side id belongs to exactly one video.
CREATE TABLE IF NOT EXISTS media_provider_refs (
  provider TEXT NOT NULL,
  ref TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, ref)
);
CREATE INDEX IF NOT EXISTS idx_media_provider_refs_video ON media_provider_refs (video_id);
