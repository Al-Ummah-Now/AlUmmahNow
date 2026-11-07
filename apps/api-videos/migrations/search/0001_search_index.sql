-- Search index (Epic 29, Story 29.9)
--
-- One base table per entity type holds filter/sort columns and the JSON payload
-- rendered in results. A matching FTS5 table holds normalised text (see
-- packages/shared-types/src/search/normalize.ts); its rowid equals the base
-- row's rowid. Text is normalised in code (Arabic folding, article stripping),
-- so the tokenizer only needs to split words.
--
-- Rows are written by api-videos (on every R2 write) and the processor
-- (SearchIndexSync queue messages), and rebuilt by POST /internal/search/backfill.

CREATE TABLE IF NOT EXISTS search_videos (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  channel_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  language TEXT,
  category TEXT,
  duration INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_live INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  popularity REAL NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  content_hash TEXT,
  indexed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_videos_channel ON search_videos (channel_id);
CREATE INDEX IF NOT EXISTS idx_search_videos_created ON search_videos (created_at);
CREATE INDEX IF NOT EXISTS idx_search_videos_category ON search_videos (category, created_at);
CREATE INDEX IF NOT EXISTS idx_search_videos_language ON search_videos (language, created_at);
CREATE INDEX IF NOT EXISTS idx_search_videos_indexed ON search_videos (indexed_at);
CREATE VIRTUAL TABLE IF NOT EXISTS search_videos_fts USING fts5 (
  title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

CREATE TABLE IF NOT EXISTS search_channels (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  channel_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  language TEXT,
  category TEXT,
  duration INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_live INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  popularity REAL NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  content_hash TEXT,
  indexed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_channels_created ON search_channels (visible, created_at);
CREATE INDEX IF NOT EXISTS idx_search_channels_indexed ON search_channels (indexed_at);
CREATE VIRTUAL TABLE IF NOT EXISTS search_channels_fts USING fts5 (
  title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

CREATE TABLE IF NOT EXISTS search_playlists (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  channel_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  language TEXT,
  category TEXT,
  duration INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_live INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  popularity REAL NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  content_hash TEXT,
  indexed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_playlists_channel ON search_playlists (channel_id);
CREATE INDEX IF NOT EXISTS idx_search_playlists_indexed ON search_playlists (indexed_at);
CREATE VIRTUAL TABLE IF NOT EXISTS search_playlists_fts USING fts5 (
  title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

CREATE TABLE IF NOT EXISTS search_posts (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  channel_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  language TEXT,
  category TEXT,
  duration INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_live INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  popularity REAL NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  content_hash TEXT,
  indexed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_posts_channel ON search_posts (channel_id);
CREATE INDEX IF NOT EXISTS idx_search_posts_indexed ON search_posts (indexed_at);
CREATE VIRTUAL TABLE IF NOT EXISTS search_posts_fts USING fts5 (
  title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);

-- Reconciliation sweep state (cursor per entity type, last full pass start).
CREATE TABLE IF NOT EXISTS search_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
