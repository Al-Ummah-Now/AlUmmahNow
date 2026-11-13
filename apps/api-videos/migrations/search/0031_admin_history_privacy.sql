-- Admin history and account erasure (#1253). Expand-only: one new table and indexes.
-- Admin history (admin_deletions, finished admin_jobs) is kept 2 years, then purged by the
-- processor's daily cron. Erasing an account keeps the action records but replaces the account's
-- titles, names and ids in them with placeholders ("erased video", "erased user", deleted-user).
-- The erasure finds the rows through these indexes, never a scan.

-- Every user a job names (actor, user target, user ids in its params), written by createJob
-- (api-videos lib/admin/jobs.ts): the erasure's lookup for admin_jobs.
CREATE TABLE IF NOT EXISTS admin_job_users (
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  PRIMARY KEY (user_id, job_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_admin_job_users_job ON admin_job_users (job_id);

-- The erasure's lookups in admin_deletions
CREATE INDEX IF NOT EXISTS idx_admin_deletions_owner ON admin_deletions (owner_id);
CREATE INDEX IF NOT EXISTS idx_admin_deletions_deleted_by ON admin_deletions (deleted_by);
CREATE INDEX IF NOT EXISTS idx_admin_deletions_purge_by ON admin_deletions (purge_requested_by);

-- The 2-year retention of finished jobs
CREATE INDEX IF NOT EXISTS idx_admin_jobs_finished ON admin_jobs (finished_at);
