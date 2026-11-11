-- Live providers (D3, 2026-11-11: both providers in production, round-robin,
-- decide on data). packages/shared-types/src/live-providers.ts,
-- apps/api-videos/src/lib/live/*, docs/research/live-2026-11/REPORT.md.
--
-- 0020–0026 are taken (media delivery, user search, originals, playback fallbacks, suggest).

-- Admin settings, one JSON document per key ('routing'). Read with a 15 s
-- per-isolate cache on stream create; audit rows are written by admin-api.
CREATE TABLE IF NOT EXISTS live_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
) WITHOUT ROWID;

-- Shared round-robin counter (one row per name): UPDATE … RETURNING gives each
-- new stream the next sequence number.
CREATE TABLE IF NOT EXISTS live_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
INSERT OR IGNORE INTO live_counters (name, value) VALUES ('assign', 0);

-- A channel forced to one provider.
CREATE TABLE IF NOT EXISTS live_channel_overrides (
  channel_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('bunny', 'selfhosted')),
  note TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- One row per provisioned session of a stream (a stream gets a new session
-- when it is moved to the other provider or restarted after it ended).
-- Times are epoch milliseconds; NULL until they happen.
CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  channel_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('bunny', 'selfhosted')),
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'live', 'ended', 'failed')),
  reason TEXT NOT NULL,
  preferred TEXT,
  seq INTEGER,
  failover_from TEXT,
  failover_error TEXT,
  key_version INTEGER NOT NULL DEFAULT 1,
  low_latency INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  start_requested_at INTEGER,
  ingest_connected_at INTEGER,
  first_segment_at INTEGER,
  last_segment_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT,
  vod_ready_at INTEGER,
  vod_url TEXT,
  playback_url TEXT,
  -- Cost units (self-hosted: counted at the edge; Bunny: from its statistics)
  ingest_bytes INTEGER NOT NULL DEFAULT 0,
  segments INTEGER NOT NULL DEFAULT 0,
  reconnects INTEGER NOT NULL DEFAULT 0,
  edge_requests INTEGER NOT NULL DEFAULT 0,
  delivered_bytes INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  r2_reads INTEGER NOT NULL DEFAULT 0,
  r2_writes INTEGER NOT NULL DEFAULT 0,
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  viewer_seconds INTEGER NOT NULL DEFAULT 0,
  error TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_live_sessions_stream ON live_sessions (stream_id, created_at);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions (status, provider);
CREATE INDEX IF NOT EXISTS idx_live_sessions_created ON live_sessions (created_at, provider);

-- Session events: assignment, failover, ingest connect, reconnect (with gap
-- and recovery time), idle end, VOD ready, provider errors.
CREATE TABLE IF NOT EXISTS live_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  value REAL,
  detail TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_live_events_session ON live_events (session_id, at);
CREATE INDEX IF NOT EXISTS idx_live_events_kind ON live_events (kind, at);

-- Self-hosted segment index (the VOD playlist is built from it on stop).
CREATE TABLE IF NOT EXISTS live_segments (
  session_id TEXT NOT NULL,
  rendition TEXT NOT NULL,
  seq INTEGER NOT NULL,
  uri TEXT NOT NULL,
  duration REAL NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, rendition, seq)
) WITHOUT ROWID;

-- Sampled player QoE beacons (shared-types LiveQoeBeacon). Kept 90 days.
CREATE TABLE IF NOT EXISTS live_qoe (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  viewer_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  startup_ms INTEGER,
  latency_p50_ms INTEGER,
  latency_max_ms INTEGER,
  latency_samples TEXT,
  live_edge_sec REAL,
  rebuffer_count INTEGER NOT NULL DEFAULT 0,
  rebuffer_ms INTEGER NOT NULL DEFAULT 0,
  watch_ms INTEGER NOT NULL DEFAULT 0,
  bitrate_kbps INTEGER,
  switches INTEGER NOT NULL DEFAULT 0,
  dropped_frames INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  colo TEXT,
  is_test INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_live_qoe_at ON live_qoe (at, provider);
CREATE INDEX IF NOT EXISTS idx_live_qoe_session ON live_qoe (session_id, at);
