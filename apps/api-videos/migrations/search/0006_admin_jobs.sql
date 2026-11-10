-- Admin content jobs (lib/admin/jobs.ts): heavy admin actions (suspension and
-- ban cascades, channel/video purges, transfers, moves, user data deletes) run
-- from the admin-jobs queue instead of inside the request. One row per job:
-- the admin sees its status on the item, and failures stay here (status
-- 'failed', last_error) until an admin retries them.
-- Expand-only: a new table and indexes.
CREATE TABLE IF NOT EXISTS admin_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  -- queued | running | retrying | succeeded | failed
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  result TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_jobs_target ON admin_jobs (target_kind, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_jobs_status ON admin_jobs (status, updated_at);
