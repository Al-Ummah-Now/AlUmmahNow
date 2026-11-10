-- Community post likes and poll votes (docs/architecture/SCALABILITY-AUDIT.md, PR-2/3/4).
--
-- The processor used to recount likes and votes by listing R2 (and reading
-- every vote document), then rewrote the whole post document and
-- votes/<postId>/results.json without a conditional write: concurrent events
-- lost updates, reverted author edits, and popular polls ran out of
-- subrequests. Now:
--   * post_likes / poll_votes mirror who liked or voted (one row per post and
--     user), so an event is applied exactly once whatever the delivery count;
--   * the totals are counters in analytics_daily (entity_type 'post'):
--       metric 'likes'        dim ''           likes per day
--       metric 'poll_votes'   dim ''           voters per day
--       metric 'poll_option'  dim '<optionId>' votes per option per day
--     changed only in the same transaction as the row that justifies them;
--   * the post document is never written by the processor again.
-- A row with liked = 0 / option_ids = '[]' is a tombstone: it stops a late
-- legacy import from bringing back a like or vote that was removed.
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  liked INTEGER NOT NULL,             -- 1 liked, 0 removed
  day TEXT NOT NULL,                  -- UTC day the like was counted on
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  option_ids TEXT NOT NULL,           -- JSON array; '[]' = no vote (removed)
  day TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_poll_votes_user ON poll_votes(user_id);

-- Legacy import of a post's likes ('likes') or votes ('votes') from R2.
-- Readers use the D1 counters only once done = 1; until then they read the
-- totals the post document already carries. One consumer at a time imports
-- a post (lease_owner until lease_until), so a burst of events on a big
-- legacy poll does not make every consumer read every vote.
CREATE TABLE IF NOT EXISTS post_counter_imports (
  post_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'likes' | 'votes'
  cursor TEXT,                        -- R2 list cursor of the next page
  done INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,  -- epoch ms
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, kind)
) WITHOUT ROWID;
