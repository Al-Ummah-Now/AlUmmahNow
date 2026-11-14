-- On-demand transcription jobs (AUN-CAPTIONS §5.1; packages/shared-types/src/caption-jobs.ts).
-- One row per job; its minutes are the caption_minute_holds row with hold_id = id (0032).

CREATE TABLE IF NOT EXISTS caption_jobs (
  id TEXT PRIMARY KEY,
  -- sha256(videoId|kind|language|provider): one active job per key (the partial index below)
  idempotency_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  channel_id TEXT,
  subject_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcribe')),
  language TEXT NOT NULL,
  replace_draft INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'waiting_budget', 'extracting', 'transcribing', 'postprocessing', 'ready', 'failed', 'cancelled')),
  progress_done INTEGER,
  progress_total INTEGER,
  minutes_reserved INTEGER NOT NULL DEFAULT 0,
  minutes_charged INTEGER,
  -- An admin's retry of a platform failure: nothing is charged
  waived INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  audio_manifest_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_caption_jobs_active ON caption_jobs (idempotency_key)
  WHERE status NOT IN ('ready', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_caption_jobs_video ON caption_jobs (video_id, created_at);
