-- Platform content management in admin-web (channels, videos, users).
--
-- 1. Admin columns on the ownership index, so the admin's channel, video and
--    user lists search and sort in D1 instead of scanning R2. Written by the
--    shared projection (packages/shared-types/src/search/ownership.ts) on every
--    R2 write and by the ownership pass. Rows written before this migration
--    keep admin_cols = 0 until the pass rewrites them; the admin lists advance
--    the pass while any remain (apps/api-videos/src/lib/admin/directory.ts).
--    Public readers do not use these columns.
-- admin_title, not title: QA already has a title column from the Creator Studio
-- preview migration, and SQLite has no ADD COLUMN IF NOT EXISTS.
ALTER TABLE content_ownership ADD COLUMN admin_title TEXT;
ALTER TABLE content_ownership ADD COLUMN handle TEXT;
ALTER TABLE content_ownership ADD COLUMN email TEXT;
ALTER TABLE content_ownership ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_ownership ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_ownership ADD COLUMN subscribers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_ownership ADD COLUMN admin_cols INTEGER NOT NULL DEFAULT 0;

-- kind = 'profile' rows (videos users) are listed by name and creation date.
CREATE INDEX IF NOT EXISTS idx_content_ownership_created ON content_ownership (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_content_ownership_admin_cols ON content_ownership (kind, admin_cols);

-- 2. Videos bans. A ban blocks the user on the videos platform only (uploads,
--    comments, likes, channel actions; their content is hidden). It never
--    touches the Auth account. Kept apart from the profile so it survives the
--    user's data being deleted: a deleted and banned user cannot come back by
--    creating a new profile.
CREATE TABLE IF NOT EXISTS videos_bans (
  user_id TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT NOT NULL,
  banned_at TEXT NOT NULL
) WITHOUT ROWID;

-- 3. Video comments for the admin's comment list and search. Comments are
--    embedded in the video JSON; these rows mirror them, rewritten when a video's
--    comments change (signature in admin_comment_sigs, so view-count flushes cost
--    one read) by the R2 write wrapper and by the ownership pass.
CREATE TABLE IF NOT EXISTS admin_comments (
  video_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  parent_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  is_hidden INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  created_at TEXT,
  PRIMARY KEY (video_id, comment_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_admin_comments_created ON admin_comments (created_at);
CREATE INDEX IF NOT EXISTS idx_admin_comments_user ON admin_comments (user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_comment_sigs (
  video_id TEXT PRIMARY KEY,
  sig TEXT NOT NULL
) WITHOUT ROWID;
