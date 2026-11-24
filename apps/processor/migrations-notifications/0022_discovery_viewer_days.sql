-- Popular viewer counts (wiki AUN-D1-SCALING, story D1-3a). The ranking job reads only the number
-- of distinct viewers per video and day, so once a day is closed (two days back: yesterday's salt
-- still takes views that straddle midnight) its raw discovery_viewers rows are moved into one count
-- per video. Each move counts and deletes the same rows in one transaction, so a count is never
-- lost or doubled; the reader adds these counts to whatever raw rows are left.
CREATE TABLE IF NOT EXISTS discovery_viewer_days (
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  video_id TEXT NOT NULL,
  viewers INTEGER NOT NULL,
  PRIMARY KEY (day, video_id)
) WITHOUT ROWID;
