-- Admin soft deletes (owner rule 2026-11-10): every delete made from the
-- videos admin hides the item at once and records it here; it stays
-- restorable for 30 days, then the hourly cleanup (lib/admin/deletions.ts)
-- purges it through the one hard-delete path. "Delete permanently now" only
-- sets purge_requested_at, so the next cleanup run purges it.
-- Expand-only: a new table and indexes.
CREATE TABLE IF NOT EXISTS admin_deletions (
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- the video of a comment, the channel of a community post
  parent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  owner_id TEXT,
  channel_id TEXT,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  reason TEXT,
  purge_requested_at TEXT,
  purge_requested_by TEXT,
  purge_started_at TEXT,
  purge_job_id TEXT,
  purged_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (kind, target_id)
) WITHOUT ROWID;

-- "Recently deleted" (newest first, per kind) and the cleanup's due scan.
CREATE INDEX IF NOT EXISTS idx_admin_deletions_list ON admin_deletions (kind, purged_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_admin_deletions_due ON admin_deletions (purged_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_admin_deletions_requested ON admin_deletions (purged_at, purge_requested_at);
