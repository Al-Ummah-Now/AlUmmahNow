-- YouTube Takeout files for social import sources, and who cancelled a job (wiki TOOLS-ADMIN TA-9/TA-13).
--
-- import_takeout_files: one video file of an owner's Google Takeout export, listed by Admin Tools for a
-- YouTube source. The job 'import.takeout-match' (api-videos lib/importSources/takeout.ts) matches it to
-- the source's record waiting for its file (import_source_items, awaiting_file/takeout_file), the admin
-- settles an ambiguous one, the app uploads it, and the same job posts the record's video. Unique per
-- source on the file's name and size: listing the export again finds the same rows.
--
-- import_sources.takeout_job_id: the source's latest 'import.takeout-match' job (one at a time per source).
-- admin_job_log.actor_id / actor_name: the admin who cancelled a job ("cancelled by …").
--
-- Expand-only: a new table, its indexes, four nullable columns.
CREATE TABLE IF NOT EXISTS import_takeout_files (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  youtube_id TEXT,                       -- the export metadata's video id, when the app found it
  title TEXT,
  duration_ms INTEGER,
  mime_type TEXT,
  state TEXT NOT NULL,                   -- new | matched | unmatched | ambiguous | uploading | uploaded | attached | failed
  matched_by TEXT,                       -- video_id | file_name | title | admin
  note TEXT,
  item_id TEXT,                          -- the record (import_source_items.item_id) it matched
  candidates TEXT,                       -- ambiguous: JSON array of item ids
  video_id TEXT,                         -- the video made from the file
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_id, name, size)
);
CREATE INDEX IF NOT EXISTS idx_import_takeout_files_state ON import_takeout_files (source_id, state);
CREATE INDEX IF NOT EXISTS idx_import_takeout_files_item ON import_takeout_files (source_id, item_id);
-- One file holds a record at a time: a match, an admin's pick and a concurrent step can't both claim it
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_takeout_files_holding ON import_takeout_files (source_id, item_id)
  WHERE item_id IS NOT NULL AND state IN ('matched', 'uploading', 'uploaded', 'attached');

ALTER TABLE admin_job_log ADD COLUMN actor_id TEXT;
ALTER TABLE admin_job_log ADD COLUMN actor_name TEXT;
ALTER TABLE import_sources ADD COLUMN takeout_job_id TEXT;
-- the source's sync job while it runs (released as it finishes, so a start then queues a new one); last_job_id stays for the page
ALTER TABLE import_sources ADD COLUMN sync_job_id TEXT;
