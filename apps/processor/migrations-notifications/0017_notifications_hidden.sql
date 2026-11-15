-- Notifications about soft-deleted content (#702): an admin or creator delete hides
-- the video's or channel's notification rows at once (hidden_at), and a restore
-- shows them again; the purge deletes them for good. Lists and unread counts read
-- only rows with hidden_at IS NULL.
-- Expand-only: a nullable column, no data change (old code ignores it).
ALTER TABLE notifications ADD COLUMN hidden_at INTEGER;
