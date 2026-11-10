-- Channel access index: who holds a per-channel role (admin, editor,
-- moderator) on which channel, so "my channels" can list the channels a user
-- manages without scanning the channels bucket.
--
-- The source of truth is the `members` array on the R2 channel record (the
-- owner stays `channel.userId` and has no row here). Rows are projected with
-- the channel's content_ownership row (shared syncOwnership: inline on every
-- channel put/delete, the processor, and the ownership pass), so the table is
-- rebuildable like the rest of this database. Readers re-check the role on the
-- R2 record before using a row, so a stale row never grants anything.
-- Channel roles are not site roles and never reach auth or tokens.
-- Expand-only: a new table and index.
CREATE TABLE IF NOT EXISTS channel_access (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,                       -- 'admin' | 'editor' | 'moderator'
  source_version INTEGER NOT NULL DEFAULT 0, -- R2 write time of the channel copy projected
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_access_user ON channel_access (user_id);
