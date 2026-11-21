-- COST-GAPS: every billed Cloudflare meter, and the costs outside Cloudflare.
-- Expand-only: new nullable columns and a new table; the previous collector and admin-api ignore them.

-- Workers CPU as billed (sum of CPU time, ms), KV lists and deletes apart from writes (each has its
-- own monthly allowance), Workers Logs events (estimated: logged requests x events per request) and
-- requests of Workers with Logpush on. `writes` keeps its meaning (KV writes + deletes + lists).
ALTER TABLE ops_hourly ADD COLUMN cpu_ms REAL;
ALTER TABLE ops_hourly ADD COLUMN kv_lists REAL;
ALTER TABLE ops_hourly ADD COLUMN kv_deletes REAL;
ALTER TABLE ops_hourly ADD COLUMN log_events REAL;
ALTER TABLE ops_hourly ADD COLUMN logpush_requests REAL;
ALTER TABLE ops_daily ADD COLUMN cpu_ms REAL;
ALTER TABLE ops_daily ADD COLUMN kv_lists REAL;
ALTER TABLE ops_daily ADD COLUMN kv_deletes REAL;
ALTER TABLE ops_daily ADD COLUMN log_events REAL;
ALTER TABLE ops_daily ADD COLUMN logpush_requests REAL;

-- What the Workers listing says about each Worker's logging (discovery): Logpush on, and the Workers
-- Logs sampling rate (NULL when the listing does not say; the collector then assumes 1).
ALTER TABLE ops_resources ADD COLUMN logpush INTEGER;
ALTER TABLE ops_resources ADD COLUMN logs_rate REAL;

-- Fixed and other costs (Apple Developer, domains, GitHub, Linear, AI subscriptions…): set by super
-- admins on the Costs page (admin-api, audited in site_settings_log), counted in the budget.
CREATE TABLE IF NOT EXISTS cost_fixed_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount_usd REAL NOT NULL CHECK (amount_usd > 0),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  start_date TEXT NOT NULL,       -- 'YYYY-MM-DD'
  end_date TEXT,                  -- 'YYYY-MM-DD' or NULL (still paid)
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
