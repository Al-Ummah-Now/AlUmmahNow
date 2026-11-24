-- D1 capacity alerts (wiki AUN-D1-SCALING, story D1-1).
-- Four new threshold metrics for D1 databases, one alert-email kind ('capacity') and the
-- account-wide D1 storage total. Expand-only: the two tables whose CHECK must widen are rebuilt
-- with every existing column and row (SQLite cannot widen a CHECK in place), so the previous
-- collector and admin-api keep working against them. ops_resources, ops_hourly and ops_daily are
-- not touched: the account total has no env and lives in its own table.

CREATE TABLE ops_thresholds_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- resource kind the rule applies to ('d1_account' for the account total)
  metric TEXT NOT NULL CHECK (metric IN ('error_rate', 'cpu_p99', 'latency_p99', 'backlog_max', 'dlq_backlog',
    'storage_pct', 'storage_days_to_70', 'busy_pct', 'account_storage_pct')),
  op TEXT NOT NULL CHECK (op IN ('>', '<')),
  value REAL NOT NULL,
  window_hours INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO ops_thresholds_new (id, kind, metric, op, value, window_hours, enabled, updated_by, updated_at)
SELECT id, kind, metric, op, value, window_hours, enabled, updated_by, updated_at FROM ops_thresholds;
DROP TABLE ops_thresholds;
ALTER TABLE ops_thresholds_new RENAME TO ops_thresholds;

CREATE TABLE cost_alert_subscriptions_new (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('budget', 'spike', 'digest', 'capacity')),
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
INSERT INTO cost_alert_subscriptions_new (user_id, kind, email, locale, created_at)
SELECT user_id, kind, email, locale, created_at FROM cost_alert_subscriptions;
DROP TABLE cost_alert_subscriptions;
ALTER TABLE cost_alert_subscriptions_new RENAME TO cost_alert_subscriptions;

-- The size of every D1 database on the account, summed once per hourly run. Other projects share
-- the account and count toward its 1 TB limit, so they are summed here, but their names are never
-- stored. Kept 396 days, like ops_hourly.
CREATE TABLE IF NOT EXISTS d1_account_storage (
  hour TEXT PRIMARY KEY,          -- '2026-11-24T15:00:00Z'
  bytes REAL NOT NULL,
  databases INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- Default rules (editable on the admin thresholds UI). storage_pct and account_storage_pct are
-- fractions of the limits in cost_settings 'd1_limits' (defaults: 10 GB per database, 1 TB per
-- account); busy_pct is the hourly share of query time, judged as the lowest hour of its window.
INSERT OR IGNORE INTO ops_thresholds (id, kind, metric, op, value, window_hours, enabled, updated_at) VALUES
  ('d1-storage-70', 'd1', 'storage_pct', '>', 0.7, 1, 1, '2026-11-24T00:00:00Z'),
  ('d1-storage-90', 'd1', 'storage_pct', '>', 0.9, 1, 1, '2026-11-24T00:00:00Z'),
  ('d1-storage-forecast', 'd1', 'storage_days_to_70', '<', 60, 1, 1, '2026-11-24T00:00:00Z'),
  ('d1-busy-70', 'd1', 'busy_pct', '>', 0.7, 3, 1, '2026-11-24T00:00:00Z'),
  ('d1-account-storage-70', 'd1_account', 'account_storage_pct', '>', 0.7, 1, 1, '2026-11-24T00:00:00Z');
