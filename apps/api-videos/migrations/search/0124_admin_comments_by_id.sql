-- A comment by its id alone (the admin lookup of a reported comment whose video is on no channel,
-- src/lib/admin/lookup.ts): the primary key starts with the video.
CREATE INDEX IF NOT EXISTS idx_admin_comments_comment ON admin_comments (comment_id);
