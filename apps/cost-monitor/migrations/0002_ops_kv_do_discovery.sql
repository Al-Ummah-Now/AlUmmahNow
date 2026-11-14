-- KV namespaces and Durable Objects get rows too, and the collector discovers every al-ummah
-- resource on the shared account (src/discover.ts) instead of only the static manifest.
-- Expand-only: ops_hourly is rebuilt with every existing column and row (SQLite cannot widen a
-- CHECK in place), so the previous collector and admin-api keep working against it.

CREATE TABLE ops_hourly_new (
  hour TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'r2', 'queue', 'kv', 'do')),
  env TEXT NOT NULL CHECK (env IN ('production', 'stage', 'qa')),
  name TEXT NOT NULL,
  requests REAL,
  errors REAL,
  cpu_p50 REAL,
  cpu_p99 REAL,
  latency_p50 REAL,
  latency_p99 REAL,
  reads REAL,                     -- also KV reads and DO storage read units
  writes REAL,                    -- also KV writes/deletes/lists and DO storage write units
  bytes REAL,
  stored_bytes REAL,
  objects REAL,                   -- also KV key count
  backlog_avg REAL,
  backlog_max REAL,
  updated_at TEXT NOT NULL,
  gb_seconds REAL,                -- DO duration (active time x 128 MB)
  PRIMARY KEY (hour, resource_id)
);
INSERT INTO ops_hourly_new (hour, resource_id, kind, env, name, requests, errors, cpu_p50, cpu_p99, latency_p50, latency_p99,
  reads, writes, bytes, stored_bytes, objects, backlog_avg, backlog_max, updated_at)
SELECT hour, resource_id, kind, env, name, requests, errors, cpu_p50, cpu_p99, latency_p50, latency_p99,
  reads, writes, bytes, stored_bytes, objects, backlog_avg, backlog_max, updated_at FROM ops_hourly;
DROP TABLE ops_hourly;
ALTER TABLE ops_hourly_new RENAME TO ops_hourly;
CREATE INDEX IF NOT EXISTS idx_ops_hourly_env_kind_hour ON ops_hourly (env, kind, hour);

ALTER TABLE ops_daily ADD COLUMN gb_seconds REAL;

-- What discovery last saw (names and ids only); rows unseen for 7 days are dropped by the collector.
CREATE TABLE IF NOT EXISTS ops_resources (
  id TEXT PRIMARY KEY,            -- '<kind>:<name>'
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'r2', 'queue', 'kv', 'do')),
  env TEXT NOT NULL CHECK (env IN ('production', 'stage', 'qa')),
  name TEXT NOT NULL,
  cf_id TEXT,                     -- D1 / KV / queue / DO namespace id (GraphQL groups by it)
  seen_at TEXT NOT NULL
);

-- Spend alerts (budget levels and day-over-day jumps), one open row per key like ops_alerts.
CREATE TABLE IF NOT EXISTS ops_cost_alerts (
  key TEXT PRIMARY KEY,           -- 'ops-cost:budget:<month>:<level>' or 'ops-cost:spike:<env>:<resource|total>'
  value REAL,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
