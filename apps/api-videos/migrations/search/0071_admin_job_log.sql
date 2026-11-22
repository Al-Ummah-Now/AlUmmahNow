-- Admin jobs on the Jobs page (wiki TOOLS-ADMIN TA-8): when the queue delivers a job next, and a
-- short log per job (lib/admin/jobs.ts). Log lines are events (queued, started, waiting,
-- failed_attempt, failed, succeeded, cancelled), so the page shows them in the admin's language;
-- `error` is the attempt's message, like admin_jobs.last_error. The newest 50 lines per job are kept.
-- A job may now also be 'cancelled' (an admin stopped it; it runs again only through Retry). run_id names
-- the job's current run: queue messages carry it, so a delivery left from before a Cancel never runs
-- next to the run Retry started.
--
-- Expand-only: new nullable columns, a new table and its index.
ALTER TABLE admin_jobs ADD COLUMN next_run_at TEXT;
ALTER TABLE admin_jobs ADD COLUMN run_id TEXT;

CREATE TABLE IF NOT EXISTS admin_job_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  attempt INTEGER,
  error TEXT,
  delay_seconds INTEGER,
  retried INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_job_log_job ON admin_job_log (job_id, id);
