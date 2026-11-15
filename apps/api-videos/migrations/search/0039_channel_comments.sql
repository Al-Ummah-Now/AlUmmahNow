-- Studio Comments page (docs/specs/CREATOR-STUDIO.md §4.7, §8.1; #771).
--
-- channel_comments: one row per comment on a channel's videos and posts (replies included),
-- with status and author only. R2 stays the source of truth (video comments inside the video
-- object, post comments under comments/<postId>/), the text is read from there. Written when
-- R2 changes (lib/channelComments/index.ts) and rebuilt per channel by a queued job.
CREATE TABLE IF NOT EXISTS channel_comments (
  comment_id TEXT PRIMARY KEY,
  -- The channel whose video or post it is on (not the author's channel)
  channel_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('video', 'post')),
  target_id TEXT NOT NULL,
  -- Top-level comment of a reply; NULL for a top-level comment
  parent_id TEXT,
  author_user_id TEXT NOT NULL,
  author_channel_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'held', 'removed')),
  -- Who holds a held comment: NULL (held for the channel's review), platform moderation, or a channel block
  held_by TEXT CHECK (held_by IS NULL OR held_by IN ('moderation', 'channel_block')),
  removed_by_user_id TEXT,
  removed_at TEXT,
  has_link INTEGER NOT NULL DEFAULT 0,
  has_channel_reply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_channel_comments_list ON channel_comments (channel_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_comments_author ON channel_comments (author_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_comments_target ON channel_comments (target_kind, target_id);
-- The daily purge of comments the channel removed more than 90 days ago
CREATE INDEX IF NOT EXISTS idx_channel_comments_removed ON channel_comments (status, removed_at);

-- What the rows of a video were written from (a signature of its comments), so a write of the
-- video that leaves its comments alone (a view count, an edit) costs one read.
CREATE TABLE IF NOT EXISTS channel_comment_sigs (
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  sig TEXT NOT NULL,
  PRIMARY KEY (target_kind, target_id)
) WITHOUT ROWID;

-- Whether a channel's rows were built: no row = never built (the first Studio visit queues a
-- rebuild); 'building' while it runs; 'ready'; 'stale' when a write could not be indexed;
-- 'failed' when the rebuild gave up (flagged on the admin Errors page with Retry).
CREATE TABLE IF NOT EXISTS channel_comments_index_state (
  channel_id TEXT PRIMARY KEY,
  indexed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'stale', 'failed')),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- People a channel blocked from commenting (silent: their new comments are held with
-- held_by 'channel_block', seen only by them). The only copy, never rebuilt. The spec's
-- CHANNEL_ROLES_DB does not exist yet, so the table lives here. Rows go with the account on erasure.
CREATE TABLE IF NOT EXISTS channel_blocks (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  blocked_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_channel_blocks_user ON channel_blocks (user_id);
