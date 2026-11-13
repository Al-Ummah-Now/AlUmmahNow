-- Bell badge = "new since you last looked" (2026-11-13). Opening the notification
-- menu stores the time here (one row per user, one write per open); the badge counts
-- unread notifications created after it. Read state stays per notification (is_read).
-- Personal data: exported with the user's data and erased with the account.

CREATE TABLE IF NOT EXISTS notification_seen (
  user_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
) WITHOUT ROWID;

-- The badge count: a range over one user's unread rows by created_at, from the index only.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON notifications(user_id, is_read, created_at);
