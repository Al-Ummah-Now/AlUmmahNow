-- COST-1: credentials set in the videos admin (Costs → Connections), per-product daily usage that
-- the collector pulls beyond ops_daily (Containers, Bunny, Resend), editable alert settings and
-- opt-in alert subscriptions. Expand-only.

-- One row per provider. The value is AES-256-GCM sealed (packages/shared-types cost-credentials.ts);
-- admin-api writes it, the collector reads it. Never returned to a browser: only last4 and who/when.
CREATE TABLE IF NOT EXISTS cost_credentials (
  provider TEXT PRIMARY KEY CHECK (provider IN ('cloudflare', 'bunny', 'resend')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  last4 TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_by_name TEXT,
  updated_at TEXT NOT NULL,
  test_ok INTEGER,
  test_message TEXT,
  test_at TEXT,
  test_detail TEXT                -- JSON { code, checks: [{ name, ok }] } of the last test (no key, no body)
);

-- Daily usage and estimated cost per product and env, for what ops_daily does not cover.
-- env 'account' = account-wide (Bunny billing, Resend). Written only by the collector.
CREATE TABLE IF NOT EXISTS cost_product_daily (
  day TEXT NOT NULL,              -- 'YYYY-MM-DD' (UTC)
  env TEXT NOT NULL CHECK (env IN ('production', 'stage', 'qa', 'account')),
  product TEXT NOT NULL,          -- containers | bunny | resend
  quantity REAL,                  -- in `unit`
  unit TEXT,                      -- e.g. 'vCPU-s', 'emails', 'usd'
  cost_usd REAL NOT NULL,
  source TEXT NOT NULL,           -- 'cloudflare-graphql' | 'bunny-billing' | 'resend-emails'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, env, product)
);
CREATE INDEX IF NOT EXISTS idx_cost_product_daily_product_day ON cost_product_daily (product, day);

-- Alert settings (one JSON row, key 'alerts'); super admins edit them, audited in site_settings_log.
CREATE TABLE IF NOT EXISTS cost_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- O24: alerts are opt-in. Each admin subscribes only themselves; the address is the one on their account.
CREATE TABLE IF NOT EXISTS cost_alert_subscriptions (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('budget', 'spike', 'digest')),
  email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Each alert email once per subscriber (fingerprint = alert key, or 'digest:<week>').
CREATE TABLE IF NOT EXISTS cost_alert_deliveries (
  fingerprint TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'sunk', 'skipped', 'failed')),
  kind TEXT NOT NULL,             -- the subscription kind it was sent for (budget | spike | digest)
  payload TEXT NOT NULL,          -- what the email says (numbers only), so a Retry sends the same email
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, user_id)
);

-- Collector job runs now include the queued product jobs.
CREATE TABLE IF NOT EXISTS cost_job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,              -- 'products:<day>' | 'bunny:<day>' | 'resend:<day>'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  detail TEXT                     -- counts and errors only, never a key or a response body
);
CREATE INDEX IF NOT EXISTS idx_cost_job_runs_started ON cost_job_runs (started_at);
