-- When a notification's realtime event and push were handed off
-- (docs/architecture/SCALABILITY-AUDIT.md, PR-10).
--
-- The processor used to push only the rows its INSERT OR IGNORE had just
-- created. If an invocation stored a fan-out and then failed before pushing
-- (subrequest limit, timeout), the retry inserted nothing and so pushed
-- nothing: those subscribers never got the push. Now every push selects the
-- event's rows with pushed_at IS NULL and sets pushed_at once handed off, so
-- a retry finishes what the failed attempt left.
ALTER TABLE notifications ADD COLUMN pushed_at INTEGER;

-- Rows stored before this column existed were pushed (or never will be).
UPDATE notifications SET pushed_at = created_at WHERE pushed_at IS NULL;

-- Small: only rows waiting for their push.
CREATE INDEX IF NOT EXISTS idx_notifications_unpushed
  ON notifications(dedupe_key, user_id) WHERE pushed_at IS NULL;
