-- Payments for creator tiers (wiki AUN-SUBS; packages/shared-types billing.ts,
-- api-videos lib/billing/*). Expand-only. Off by default: no provider row is
-- enabled, so /upgrade stays the request form.
--
-- Credentials are NOT here: they live in Cloudflare Secrets Store (admin-api
-- writes them, api-videos reads them through bindings). billing_providers keeps
-- only who set each one and when.

-- One row per configurable provider (paddle, paygood, fake). Missing row = off.
CREATE TABLE IF NOT EXISTS billing_providers (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  -- Non-secret settings (JSON object; per-mode keys as "<key>.<mode>")
  settings TEXT NOT NULL DEFAULT '{}',
  -- {"apiKey":{"test":{"setAt":..,"setBy":..}},...}: never a value
  credentials TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  updated_by TEXT
) WITHOUT ROWID;

-- Site-wide billing settings (one row, id 'default'): seller and tax details
CREATE TABLE IF NOT EXISTS billing_settings (
  id TEXT PRIMARY KEY,
  tax TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  updated_by TEXT
) WITHOUT ROWID;

-- A tier's price per period and currency, provider-agnostic (minor units)
CREATE TABLE IF NOT EXISTS billing_prices (
  id TEXT PRIMARY KEY,
  tier_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('month', 'year')),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_prices_key ON billing_prices (tier_id, period, currency);

-- The provider's own price (Paddle price id, PayGood subscription offering id) for a price
CREATE TABLE IF NOT EXISTS billing_price_links (
  price_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_ref TEXT,
  provider_product_ref TEXT,
  -- A hosted checkout link of the provider's price, when it has one (PayGood offering checkoutUrl)
  checkout_url TEXT,
  synced_amount INTEGER,
  synced_at TEXT,
  error TEXT,
  PRIMARY KEY (price_id, provider, mode)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_billing_price_links_ref ON billing_price_links (provider, mode, provider_ref);

-- A user's customer record at a provider
CREATE TABLE IF NOT EXISTS billing_customers (
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, mode, provider_ref)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_billing_customers_user ON billing_customers (user_id, provider, mode);

-- A checkout a user started (links the provider's later webhook back to the user and tier)
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired')),
  created_at TEXT NOT NULL,
  completed_at TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_billing_checkouts_user ON billing_checkouts (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_checkouts_ref ON billing_checkouts (provider, provider_ref);

-- Subscriptions (paid, or an admin comp with provider 'manual')
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  tier_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_ref TEXT,
  customer_ref TEXT,
  price_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'canceled', 'ended')),
  period TEXT,
  currency TEXT,
  amount INTEGER,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  access_until TEXT,
  -- The admin tier this subscription replaced, restored when it ends
  restore_tier_id TEXT,
  comp_by TEXT,
  comp_reason TEXT,
  -- Newest provider event applied (out-of-order events older than this do not move the status)
  last_event_at TEXT,
  -- The entitlement was brought in line after the last change (the sweep picks up 0)
  entitlement_synced INTEGER NOT NULL DEFAULT 0,
  reconcile_requested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_ref ON billing_subscriptions (provider, mode, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user ON billing_subscriptions (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON billing_subscriptions (status, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_comp_by ON billing_subscriptions (comp_by) WHERE comp_by IS NOT NULL;
-- The 10-minute sweep: rows whose access date has passed
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_access ON billing_subscriptions (access_until) WHERE access_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_sync ON billing_subscriptions (entitlement_synced, access_until);

-- Charges (billing history)
CREATE TABLE IF NOT EXISTS billing_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'refunded', 'partially_refunded')),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  receipt_url TEXT,
  occurred_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_ref ON billing_payments (provider, mode, provider_ref);
CREATE INDEX IF NOT EXISTS idx_billing_payments_user ON billing_payments (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_billing_payments_sub ON billing_payments (subscription_id, occurred_at);

-- Webhook deliveries, one row per provider event (the idempotency key)
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processed', 'ignored', 'failed')),
  error TEXT,
  user_id TEXT,
  subscription_id TEXT,
  job_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_key ON billing_events (provider, mode, event_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_status ON billing_events (status, received_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_sub ON billing_events (subscription_id, received_at);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events (user_id);
