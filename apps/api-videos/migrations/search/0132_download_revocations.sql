-- Urgent & CSAM download revocations append-only event log (Epic 14, E14-D8 / E14-S11a).
-- Keyed by UNIQUE(event_id) (not video_id) so retries are idempotent while a second takedown
-- of a previously restored video receives a new event_id and a new higher seq cursor.
CREATE TABLE IF NOT EXISTS download_revocations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  video_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
