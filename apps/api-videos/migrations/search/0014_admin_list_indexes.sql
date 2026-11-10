-- Index-backed admin lists (videos admin, processing health).
--
-- content_ownership gains the fields the admin lists read from R2 objects
-- (written from columns version 3, OWNERSHIP_ADMIN_COLS_VERSION):
--   image_url     video thumbnail, channel/profile avatar, playlist thumbnail
--   item_count    videos in a playlist
--   issue         open processing issue of a video (processingIssue.kind)
--   issue_at      when it was flagged, epoch ms
--   is_abandoned  upload removed by the upload reaper
-- Rows written before keep NULL there until the ownership pass rewrites them;
-- admin lists read the object for those rows only.
--
-- Admin search: content_ownership_fts (trigram: substring match like the
-- LIKE '%term%' it replaces, from 3 characters) over title, handle and email,
-- and admin_comments_fts over comment text, kept in step by triggers so every
-- writer (api-videos, processor, repairs, view sync) updates them.
--
-- channel_totals: videos and views per channel (not deleted), kept by
-- triggers on the video rows (one row per channel), so channel lists sort by
-- views and show totals without summing a channel's videos per row.
--
-- Admin lists page with keyset cursors (api-videos lib/search/keyset.ts); the
-- indexes cover their orders. Processing health reads partial indexes of the
-- videos it lists (not ready or flagged; failed or flagged), never the ready
-- catalogue. Triggers never rely on a conflict clause of their own: an outer
-- INSERT OR REPLACE would override it.
--
-- Expand-only: new nullable columns, new tables, triggers and indexes.
ALTER TABLE content_ownership ADD COLUMN image_url TEXT;
ALTER TABLE content_ownership ADD COLUMN item_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_ownership ADD COLUMN issue TEXT;
ALTER TABLE content_ownership ADD COLUMN issue_at INTEGER;
ALTER TABLE content_ownership ADD COLUMN is_abandoned INTEGER NOT NULL DEFAULT 0;

-- Admin list orders (newest/oldest/views use the 0013 feed indexes)
CREATE INDEX IF NOT EXISTS idx_content_ownership_title ON content_ownership (kind, lower(COALESCE(admin_title, '')), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_title ON content_ownership (kind, channel_id, lower(COALESCE(admin_title, '')), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_owner_feed ON content_ownership (kind, owner_id, COALESCE(created_at, 0), id);
CREATE INDEX IF NOT EXISTS idx_content_ownership_status_feed ON content_ownership (kind, upload_status, COALESCE(created_at, 0), id);
-- Banned users whose profile was erased, by ban time (admin Users list)
CREATE INDEX IF NOT EXISTS idx_videos_bans_banned ON videos_bans (COALESCE(CAST(strftime('%s', banned_at) AS INTEGER), 0) * 1000, user_id);
-- Users by email (channel search by the owner's email)
CREATE INDEX IF NOT EXISTS idx_content_ownership_email ON content_ownership (kind, lower(email)) WHERE email IS NOT NULL;

-- Processing health (admin Processing and Errors pages). Partial indexes hold
-- only the videos the pages list, so a page never walks the ready catalogue:
-- not ready or flagged (and not abandoned), newest first ...
CREATE INDEX IF NOT EXISTS idx_content_ownership_stuck ON content_ownership (kind, COALESCE(created_at, 0), id)
WHERE is_abandoned = 0 AND ((upload_status IS NOT NULL AND upload_status <> 'ready') OR issue IS NOT NULL);
-- ... and failed or flagged, latest flag (or change) first
CREATE INDEX IF NOT EXISTS idx_content_ownership_errors ON content_ownership (kind, COALESCE(issue_at, updated_at, 0), id)
WHERE issue IS NOT NULL OR upload_status = 'failed';

-- ---------------------------------------------------------------------------
-- Channel totals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_totals (
  channel_id TEXT PRIMARY KEY,
  videos INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_channel_totals_views ON channel_totals (views, channel_id);

-- Every channel has a row (zero until it has videos), so the channels list
-- sorted by views is one walk of idx_channel_totals_views. Inserts in the
-- triggers check for the row instead of using a conflict clause (an outer
-- statement's OR clause would override it).
CREATE TRIGGER IF NOT EXISTS trg_channel_totals_channel AFTER INSERT ON content_ownership
WHEN new.kind = 'channel'
BEGIN
  INSERT INTO channel_totals (channel_id, videos, views)
  SELECT new.id, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM channel_totals WHERE channel_id = new.id);
END;

CREATE TRIGGER IF NOT EXISTS trg_channel_totals_insert AFTER INSERT ON content_ownership
WHEN new.kind = 'video' AND new.is_deleted = 0 AND new.channel_id IS NOT NULL
BEGIN
  UPDATE channel_totals SET videos = videos + 1, views = views + new.views WHERE channel_id = new.channel_id;
  INSERT INTO channel_totals (channel_id, videos, views)
  SELECT new.channel_id, 1, new.views WHERE NOT EXISTS (SELECT 1 FROM channel_totals WHERE channel_id = new.channel_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_channel_totals_delete AFTER DELETE ON content_ownership
WHEN old.kind = 'video' AND old.is_deleted = 0 AND old.channel_id IS NOT NULL
BEGIN
  UPDATE channel_totals SET videos = videos - 1, views = views - old.views WHERE channel_id = old.channel_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_channel_totals_update AFTER UPDATE OF channel_id, is_deleted, views ON content_ownership
WHEN new.kind = 'video'
  AND (old.channel_id IS NOT new.channel_id OR old.is_deleted IS NOT new.is_deleted OR old.views IS NOT new.views)
BEGIN
  UPDATE channel_totals SET videos = videos - 1, views = views - old.views
  WHERE channel_id = old.channel_id AND old.is_deleted = 0;
  UPDATE channel_totals SET videos = videos + 1, views = views + new.views
  WHERE channel_id = new.channel_id AND new.is_deleted = 0;
  INSERT INTO channel_totals (channel_id, videos, views)
  SELECT new.channel_id, 1, new.views
  WHERE new.is_deleted = 0 AND new.channel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM channel_totals WHERE channel_id = new.channel_id);
END;

INSERT INTO channel_totals (channel_id, videos, views)
SELECT channel_id, COUNT(*), COALESCE(SUM(views), 0) FROM content_ownership
WHERE kind = 'video' AND is_deleted = 0 AND channel_id IS NOT NULL
GROUP BY channel_id;
INSERT INTO channel_totals (channel_id, videos, views)
SELECT c.id, 0, 0 FROM content_ownership c
WHERE c.kind = 'channel' AND NOT EXISTS (SELECT 1 FROM channel_totals t WHERE t.channel_id = c.id);

-- ---------------------------------------------------------------------------
-- Admin search over titles, handles and emails
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS content_ownership_fts USING fts5 (
  admin_title, handle, email,
  content = 'content_ownership', content_rowid = 'rowid', tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS trg_content_ownership_fts_insert AFTER INSERT ON content_ownership
BEGIN
  INSERT INTO content_ownership_fts (rowid, admin_title, handle, email) VALUES (new.rowid, new.admin_title, new.handle, new.email);
END;

CREATE TRIGGER IF NOT EXISTS trg_content_ownership_fts_delete AFTER DELETE ON content_ownership
BEGIN
  INSERT INTO content_ownership_fts (content_ownership_fts, rowid, admin_title, handle, email) VALUES ('delete', old.rowid, old.admin_title, old.handle, old.email);
END;

CREATE TRIGGER IF NOT EXISTS trg_content_ownership_fts_update AFTER UPDATE OF admin_title, handle, email ON content_ownership
WHEN old.admin_title IS NOT new.admin_title OR old.handle IS NOT new.handle OR old.email IS NOT new.email
BEGIN
  INSERT INTO content_ownership_fts (content_ownership_fts, rowid, admin_title, handle, email) VALUES ('delete', old.rowid, old.admin_title, old.handle, old.email);
  INSERT INTO content_ownership_fts (rowid, admin_title, handle, email) VALUES (new.rowid, new.admin_title, new.handle, new.email);
END;

INSERT INTO content_ownership_fts (content_ownership_fts) VALUES ('rebuild');

-- ---------------------------------------------------------------------------
-- Admin search over comment text (admin_comments has no rowid: keys map it)
--
-- The triggers never rely on their own conflict clause: an outer INSERT OR
-- REPLACE overrides the conflict policy of every statement in its triggers
-- (an OR IGNORE here would replace the key and orphan the old text row),
-- and the row it replaces fires the delete trigger only with
-- recursive_triggers on. Written so either way leaves one text row per
-- comment: the insert trigger adds the key only when missing, then replaces
-- the text row by the key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_comment_keys (
  k INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  UNIQUE (video_id, comment_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS admin_comments_fts USING fts5 (text, tokenize = 'trigram');

CREATE TRIGGER IF NOT EXISTS trg_admin_comments_fts_insert AFTER INSERT ON admin_comments
BEGIN
  INSERT INTO admin_comment_keys (video_id, comment_id)
  SELECT new.video_id, new.comment_id
  WHERE NOT EXISTS (SELECT 1 FROM admin_comment_keys WHERE video_id = new.video_id AND comment_id = new.comment_id);
  DELETE FROM admin_comments_fts WHERE rowid = (SELECT k FROM admin_comment_keys WHERE video_id = new.video_id AND comment_id = new.comment_id);
  INSERT INTO admin_comments_fts (rowid, text)
  SELECT k, new.text FROM admin_comment_keys WHERE video_id = new.video_id AND comment_id = new.comment_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_comments_fts_delete AFTER DELETE ON admin_comments
BEGIN
  DELETE FROM admin_comments_fts WHERE rowid = (SELECT k FROM admin_comment_keys WHERE video_id = old.video_id AND comment_id = old.comment_id);
  DELETE FROM admin_comment_keys WHERE video_id = old.video_id AND comment_id = old.comment_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_comments_fts_update AFTER UPDATE OF text ON admin_comments
WHEN old.text IS NOT new.text
BEGIN
  DELETE FROM admin_comments_fts WHERE rowid = (SELECT k FROM admin_comment_keys WHERE video_id = new.video_id AND comment_id = new.comment_id);
  INSERT INTO admin_comments_fts (rowid, text)
  SELECT k, new.text FROM admin_comment_keys WHERE video_id = new.video_id AND comment_id = new.comment_id;
END;

INSERT INTO admin_comment_keys (video_id, comment_id)
SELECT c.video_id, c.comment_id FROM admin_comments c
WHERE NOT EXISTS (SELECT 1 FROM admin_comment_keys k WHERE k.video_id = c.video_id AND k.comment_id = c.comment_id);
INSERT INTO admin_comments_fts (rowid, text)
SELECT k.k, c.text FROM admin_comments c JOIN admin_comment_keys k ON k.video_id = c.video_id AND k.comment_id = c.comment_id;

-- Admin comment list orders: newest first, per video, per user
CREATE INDEX IF NOT EXISTS idx_admin_comments_feed ON admin_comments (COALESCE(created_at, ''), video_id, comment_id);
CREATE INDEX IF NOT EXISTS idx_admin_comments_video_feed ON admin_comments (video_id, COALESCE(created_at, ''), comment_id);
CREATE INDEX IF NOT EXISTS idx_admin_comments_user_feed ON admin_comments (user_id, COALESCE(created_at, ''), video_id, comment_id);

-- ---------------------------------------------------------------------------
-- Admin jobs list: newest first, by status and by target, with a cursor
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_admin_jobs_feed ON admin_jobs (created_at, id);
CREATE INDEX IF NOT EXISTS idx_admin_jobs_status_feed ON admin_jobs (status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_admin_jobs_target_feed ON admin_jobs (target_kind, target_id, created_at, id);
