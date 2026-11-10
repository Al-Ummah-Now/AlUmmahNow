-- Per-object index repairs.
--
-- A write to the ownership index (content_ownership) or the search index
-- (search_*) that fails, or an object a reconcile pass could not index, used
-- to mark the whole kind incomplete: every reader then scanned R2 until the
-- next full pass, which took days. Now the one object is recorded here and
-- the 'search.repair-objects' admin job re-reads it from R2 and rewrites both
-- indexes, with backoff (next_attempt_at). After its retries the row turns
-- 'failed' and the admin Errors page lists it with Retry.
--
--   entity  video | channel | playlist | post | profile
--   r2_key  the object's key in its bucket (community posts are not keyed by id)
--   status  pending | failed
--
-- Expand-only: a new table.
CREATE TABLE IF NOT EXISTS index_repairs (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  last_error TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_index_repairs_due ON index_repairs (status, next_attempt_at);
