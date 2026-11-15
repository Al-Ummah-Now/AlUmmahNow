-- Transcript search (AUN-CAPTIONS §5.10, P5): passages of every published caption track with
-- their start time, so search can open a video where something is said (`?t=`). Written by the
-- processor (TranscriptIndexSync, packages/shared-types/src/search/transcripts.ts); the FTS row's
-- rowid equals the passage's rowid and holds the normalised text, like the other search tables.
-- Visibility comes from search_videos at query time; a deleted video's passages are removed with
-- its search row.

CREATE TABLE IF NOT EXISTS search_transcripts (
  rowid INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL,
  language TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  source_version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_search_transcripts_track ON search_transcripts (video_id, language);
CREATE VIRTUAL TABLE IF NOT EXISTS search_transcripts_fts USING fts5 (
  body, tokenize = 'unicode61 remove_diacritics 2'
);
