CREATE TABLE IF NOT EXISTS qaf_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ciphertext TEXT,
  key_version TEXT,
  user_minute INTEGER NOT NULL DEFAULT 6,
  global_minute INTEGER NOT NULL DEFAULT 30,
  user_week INTEGER NOT NULL DEFAULT 25,
  global_week INTEGER NOT NULL DEFAULT 1000,
  week_until INTEGER NOT NULL DEFAULT 0,
  minute_until INTEGER NOT NULL DEFAULT 0,
  invalid_key INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO qaf_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS qaf_usage (
  id INTEGER PRIMARY KEY,
  creator TEXT NOT NULL,
  at INTEGER NOT NULL,
  is_search INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qaf_usage_at ON qaf_usage (at);
CREATE INDEX IF NOT EXISTS qaf_usage_creator_at ON qaf_usage (creator, at);
CREATE INDEX IF NOT EXISTS qaf_usage_search_at ON qaf_usage (at) WHERE is_search = 1;
CREATE INDEX IF NOT EXISTS qaf_usage_search_creator_at ON qaf_usage (creator, at) WHERE is_search = 1;
CREATE INDEX IF NOT EXISTS qaf_usage_other_at ON qaf_usage (at) WHERE is_search = 0;

CREATE TABLE IF NOT EXISTS qaf_search_cache (
  hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  response TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qaf_search_cache_expiry ON qaf_search_cache (expires_at);
