-- Discovery ranking (wiki E07 "Discovery ranking"; api-videos lib/ranking/).
-- Expand-only: new tables and one index; nothing existing changes.
--
-- The hourly 'discovery.rank' admin job writes each rail's ordered video ids
-- here; the section, trending, popular, category and explore endpoints read a
-- page with one keyset seek on (rail, scope, position).
--   rail:  'trending:day' | 'trending:week' | 'trending:month' | 'popular' | 'new' | 'featured' | 'top'
--   scope: '' | 'lang:ar' | 'lang:en' | 'cat:<category>'
CREATE TABLE IF NOT EXISTS discovery_rail_items (
  rail TEXT NOT NULL,
  scope TEXT NOT NULL,
  position INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  PRIMARY KEY (rail, scope, position)
) WITHOUT ROWID;

-- One row per rail: what it shows now (mode/label: a rail without enough
-- signal relabels, e.g. Trending -> 'new_this_week'), its size and the
-- fingerprint the job compares to skip unchanged rails.
CREATE TABLE IF NOT EXISTS discovery_rails (
  rail TEXT NOT NULL,
  scope TEXT NOT NULL,
  mode TEXT NOT NULL,
  label TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  signal_items INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (rail, scope)
) WITHOUT ROWID;

-- Admin curation (videos admin -> Discovery; every change is audited in admin-api).
-- rail: 'featured' | 'trending' | 'popular' | 'new' | 'explore' | 'category:<category>'
-- A video pin takes its slot when the video is listed; a channel pin takes the
-- channel's best video in that rail and gives the channel the featured boost.
CREATE TABLE IF NOT EXISTS discovery_pins (
  id TEXT PRIMARY KEY,
  rail TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'channel')),
  target_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER,
  ends_at INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (rail, kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_discovery_pins_rail ON discovery_pins (rail, position);

-- Videos or channels an admin keeps out of every rail (seed or demo content,
-- anything that should not be recommended). Search is unaffected.
CREATE TABLE IF NOT EXISTS discovery_exclusions (
  kind TEXT NOT NULL CHECK (kind IN ('video', 'channel')),
  target_id TEXT NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, target_id)
) WITHOUT ROWID;

-- The order (and on/off) of the home page rails, set by an admin.
-- rail: 'featured' | 'trending' | 'new' | 'popular' | 'categories'
CREATE TABLE IF NOT EXISTS discovery_home_rails (
  rail TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Comment authors per video per day for the ranking's engagement read.
CREATE INDEX IF NOT EXISTS idx_channel_comments_recent ON channel_comments (target_kind, created_at);
