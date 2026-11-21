-- Admin Tools bulk import (wiki TOOLS-ADMIN TA-3/TA-5): one batch per import run into a channel,
-- one item per file. The file's full SHA-256 is unique per channel, so the same file imported again
-- (by any admin, from any computer) resumes its unfinished video or is reported as already imported,
-- never uploaded twice. Expand-only: two new tables.
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  name TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_batches_channel ON import_batches (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_created ON import_batches (created_at);

CREATE TABLE IF NOT EXISTS import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  video_id TEXT,
  -- initiated: upload opened; uploaded: the app finished sending the file; failed: see error
  state TEXT NOT NULL DEFAULT 'initiated',
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_items_file ON import_items (channel_id, sha256);
CREATE INDEX IF NOT EXISTS idx_import_items_batch ON import_items (batch_id, created_at);
