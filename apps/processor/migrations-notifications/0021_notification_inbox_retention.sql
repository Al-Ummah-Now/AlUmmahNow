-- Notifications inbox retention (wiki AUN-D1-SCALING, story D1-2).
-- idx_notifications_user_unread (user_id, is_read) is a prefix of
-- idx_notifications_user_unread_created (user_id, is_read, created_at), which serves every query it
-- served (unread count, list, mark read), so it goes: one written index row fewer per notification.
DROP INDEX IF EXISTS idx_notifications_user_unread;

-- Where the hourly trim walk got to: the (created_at, rowid) of the last notification whose
-- recipient was trimmed. The walk reads idx_notifications_created from there, never the table.
CREATE TABLE IF NOT EXISTS notification_trim_state (
  job TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  row_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
