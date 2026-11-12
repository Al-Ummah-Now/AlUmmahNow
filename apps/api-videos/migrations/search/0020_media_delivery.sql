-- R2 delivery beside Bunny (epic #687, docs/media-delivery/R2-DELIVERY-PLAN.md). Expand-only.
-- media_jobs: one row per video, its latest R2 transcode (lib/media/r2-delivery.ts recordJob).
-- Time to playable per source, container seconds and bytes for the cost per video-minute.
CREATE TABLE IF NOT EXISTS media_jobs (
  video_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  access TEXT NOT NULL,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ready_at TEXT,
  failed_at TEXT,
  error TEXT,
  duration_seconds REAL,
  bytes INTEGER,
  objects INTEGER,
  rungs TEXT,
  container_seconds INTEGER,
  instance_type TEXT,
  -- Bunny's side of the same upload: when it first became playable (processing loop)
  bunny_ready_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_jobs (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_media_jobs_queued ON media_jobs (queued_at);

-- Player measurements per day, source, device class and country: one upsert per play session
-- (POST /api/playback/qoe). Sums, so averages are sum / count.
CREATE TABLE IF NOT EXISTS playback_qoe_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  device TEXT NOT NULL,
  country TEXT NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  started INTEGER NOT NULL DEFAULT 0,
  startup_ms_sum INTEGER NOT NULL DEFAULT 0,
  rebuffers INTEGER NOT NULL DEFAULT 0,
  rebuffer_ms INTEGER NOT NULL DEFAULT 0,
  watch_ms INTEGER NOT NULL DEFAULT 0,
  kbps_watch_s REAL NOT NULL DEFAULT 0,
  peak_kbps_sum INTEGER NOT NULL DEFAULT 0,
  switches INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  fallbacks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, device, country)
);

-- Cost inputs per day and source (cron collector): storage GB, egress GB, class A/B ops,
-- container seconds, CDN requests and cache hits, provider-reported cost.
CREATE TABLE IF NOT EXISTS delivery_cost_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, provider, metric)
);
