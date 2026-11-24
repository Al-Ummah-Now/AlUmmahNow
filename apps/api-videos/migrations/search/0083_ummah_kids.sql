-- Epic 20: Ummah Kids curated catalog, review queue, policy readiness, and parent-owned
-- parental controls (wiki E20 §5.1). Zero child personal data is stored in any table.
-- Nothing here is reachable while the `ummahKids` feature switch is off (the default).

CREATE TABLE IF NOT EXISTS kids_catalog_items (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('video', 'channel', 'playlist')),
  target_id TEXT NOT NULL,
  age_band TEXT NOT NULL CHECK (age_band IN ('3-6', '7-12', 'all')),
  status TEXT NOT NULL CHECK (status IN ('approved', 'revoked', 'deleted')),
  pre_delete_status TEXT CHECK (pre_delete_status IN ('approved', 'revoked')),
  topics_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_reason TEXT,
  purge_after TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (target_type, target_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_kids_catalog_browse ON kids_catalog_items (status, target_type, age_band, position, approved_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_kids_catalog_admin ON kids_catalog_items (status, position, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_kids_catalog_deleted ON kids_catalog_items (status, purge_after);

CREATE TABLE IF NOT EXISTS kids_review_requests (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('video', 'channel', 'playlist')),
  target_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  suggested_age_band TEXT NOT NULL CHECK (suggested_age_band IN ('3-6', '7-12', 'all')),
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
  decision_reason TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_kids_review_status ON kids_review_requests (status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_kids_review_channel ON kids_review_requests (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kids_review_requested_by ON kids_review_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_kids_review_decided_by ON kids_review_requests (decided_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kids_review_pending_target ON kids_review_requests (target_type, target_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS kids_catalog_audit (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_kids_audit_entity ON kids_catalog_audit (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kids_audit_actor_id ON kids_catalog_audit (actor_id);

CREATE TABLE IF NOT EXISTS parental_controls (
  user_id TEXT PRIMARY KEY,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_updated_at TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  pin_hard_locked INTEGER NOT NULL DEFAULT 0 CHECK (pin_hard_locked IN (0, 1)),
  active_age_band TEXT NOT NULL DEFAULT '7-12' CHECK (active_age_band IN ('3-6', '7-12')),
  daily_limit_minutes INTEGER,
  bedtime_start TEXT,
  bedtime_end TEXT,
  bedtime_timezone TEXT,
  prayer_pause_enabled INTEGER NOT NULL DEFAULT 0 CHECK (prayer_pause_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS kids_policy_settings (
  key TEXT PRIMARY KEY,
  decisions_json TEXT NOT NULL DEFAULT '{}',
  staff_channel_ids_json TEXT NOT NULL DEFAULT '[]',
  legal_approved INTEGER NOT NULL DEFAULT 0 CHECK (legal_approved IN (0, 1)),
  legal_approved_by TEXT,
  legal_approved_at TEXT,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
