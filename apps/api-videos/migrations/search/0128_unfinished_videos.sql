-- The videos that are not ready, by state, newest first: the admin lists of failed and unfinished videos read
-- these rows only, never every video in date order. A partial index of a few rows. Expand-only.
CREATE INDEX IF NOT EXISTS idx_content_ownership_unfinished ON content_ownership (upload_status, created_at DESC, id)
  WHERE kind = 'video' AND is_deleted = 0 AND upload_status <> 'ready';
