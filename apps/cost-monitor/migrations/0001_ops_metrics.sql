-- Platform analytics for the videos admin (docs/admin/LIVE_OPS.md Part A).
-- Written only by the collector (apps/cost-monitor); admin-api reads them and
-- writes only ops_thresholds. Only manifest resources (src/manifest.ts) ever get a row.

-- One row per resource-hour. Metric columns (not one row per metric) keep 13 months small.
CREATE TABLE IF NOT EXISTS ops_hourly (
  hour TEXT NOT NULL,             -- ISO hour, '2026-11-12T14:00:00Z'
  resource_id TEXT NOT NULL,      -- '<kind>:<name>', e.g. 'worker:videos-qa'
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'r2', 'queue')),
  env TEXT NOT NULL CHECK (env IN ('production', 'stage', 'qa')),
  name TEXT NOT NULL,             -- display name (database / queue name, not its id)
  requests REAL,                  -- worker requests, D1 queries, R2 operations, queue messages written
  errors REAL,                    -- worker errors
  cpu_p50 REAL,                   -- worker CPU µs
  cpu_p99 REAL,
  latency_p50 REAL,               -- D1 query batch ms
  latency_p99 REAL,
  reads REAL,                     -- D1 rows read, R2 Class B ops, queue messages read
  writes REAL,                    -- D1 rows written, R2 Class A ops, queue messages written
  bytes REAL,                     -- R2 egress bytes
  stored_bytes REAL,              -- D1 / R2 size (max in the hour)
  objects REAL,                   -- R2 object count (max in the hour)
  backlog_avg REAL,               -- queue backlog messages
  backlog_max REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (hour, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_ops_hourly_env_kind_hour ON ops_hourly (env, kind, hour);

-- Daily rollup of ops_hourly (sums, and maxima for sizes, backlog and p99s); cost is an estimate.
CREATE TABLE IF NOT EXISTS ops_daily (
  day TEXT NOT NULL,              -- 'YYYY-MM-DD' (UTC)
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  env TEXT NOT NULL,
  name TEXT NOT NULL,
  requests REAL,
  errors REAL,
  cpu_p50 REAL,
  cpu_p99 REAL,
  latency_p50 REAL,
  latency_p99 REAL,
  reads REAL,
  writes REAL,
  bytes REAL,
  stored_bytes REAL,
  objects REAL,
  backlog_avg REAL,
  backlog_max REAL,
  cost_usd REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_ops_daily_env_kind_day ON ops_daily (env, kind, day);

-- Threshold rules (defaults seeded below; super admins edit them through admin-api).
CREATE TABLE IF NOT EXISTS ops_thresholds (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- resource kind the rule applies to
  metric TEXT NOT NULL CHECK (metric IN ('error_rate', 'cpu_p99', 'latency_p99', 'backlog_max', 'dlq_backlog')),
  op TEXT NOT NULL CHECK (op IN ('>', '<')),
  value REAL NOT NULL,
  window_hours INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- Open threshold crossings, so each one is reported once and resolved when it recovers.
CREATE TABLE IF NOT EXISTS ops_alerts (
  key TEXT PRIMARY KEY,           -- 'ops:<rule id>:<resource id>' (the Errors page item key)
  rule_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  env TEXT NOT NULL,
  value REAL,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hourly', 'daily')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  queries INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  detail TEXT                     -- counts and dataset errors only, never a response body or token
);
CREATE INDEX IF NOT EXISTS idx_collector_runs_started ON collector_runs (started_at);

INSERT OR IGNORE INTO ops_thresholds (id, kind, metric, op, value, window_hours, enabled, updated_at) VALUES
  ('worker-error-rate', 'worker', 'error_rate', '>', 0.02, 1, 1, '2026-11-12T00:00:00Z'),
  ('d1-latency-p99', 'd1', 'latency_p99', '>', 500, 1, 1, '2026-11-12T00:00:00Z'),
  ('queue-backlog', 'queue', 'backlog_max', '>', 1000, 1, 1, '2026-11-12T00:00:00Z'),
  ('dlq-backlog', 'queue', 'dlq_backlog', '>', 0, 1, 1, '2026-11-12T00:00:00Z');
