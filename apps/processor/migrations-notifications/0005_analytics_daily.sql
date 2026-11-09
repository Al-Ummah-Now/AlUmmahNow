-- Daily analytics counters (docs/architecture/SCALABILITY-AUDIT.md, PR-1).
--
-- Replaces the monthly rollup documents in R2
-- (analytics/rollups/{video,channel}/<id>/<YYYY-MM>.json), which were
-- read-modify-written by every processor isolate and lost updates under
-- concurrency. Here every write is an atomic upsert,
--   INSERT ... ON CONFLICT DO UPDATE SET value = value + excluded.value,
-- so any number of concurrent writers add up exactly.
--
-- One row per entity, UTC day, metric and dimension:
--   metric 'views'        dim ''                    tracked views
--   metric 'watch_time'   dim ''                    seconds watched
--   metric 'source'       dim 'watch' | 'embed'     views per playback surface
--   metric 'embed_origin' dim '<origin>' | 'other'  embed views per embedding origin (bounded)
-- New metrics (e.g. Creator Studio retention / traffic) need no migration.
CREATE TABLE IF NOT EXISTS analytics_daily (
  entity_type TEXT NOT NULL,          -- 'video' | 'channel'
  entity_id TEXT NOT NULL,
  day TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  metric TEXT NOT NULL,
  dim TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, day, metric, dim)
) WITHOUT ROWID;

-- Legacy R2 rollup documents already added to analytics_daily. The import
-- inserts the marker in the same transaction as the counts, so a document is
-- imported at most once; readers skip any document listed here.
CREATE TABLE IF NOT EXISTS analytics_rollup_imports (
  r2_key TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL
) WITHOUT ROWID;
