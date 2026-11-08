-- Epic 27: plans & entitlements. Payment tables are deferred (D4).
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description_en TEXT,
  description_ar TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('creator', 'organisation', 'viewer', 'everyone')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_plans_one_default ON plans(is_default) WHERE is_default = 1;

CREATE TABLE plan_entitlements (
  plan_id TEXT NOT NULL REFERENCES plans(id),
  plan_version INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (plan_id, plan_version, key)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('channel', 'organisation', 'user')),
  subject_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  plan_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start TEXT,
  current_period_end TEXT,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_subscription_ref TEXT,
  assigned_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_subscriptions_live ON subscriptions(subject_type, subject_id)
  WHERE status IN ('trialing', 'active', 'past_due');
CREATE INDEX idx_subscriptions_plan ON subscriptions(plan_id, plan_version);

CREATE TABLE entitlement_overrides (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('channel', 'organisation', 'user')),
  subject_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_type, subject_id, key)
);

CREATE TABLE usage_counters (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  key TEXT NOT NULL,
  period TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subject_type, subject_id, key, period)
);

CREATE TABLE plan_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_plan_audit_entity ON plan_audit_log(entity_type, entity_id, created_at);
