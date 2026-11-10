-- Creator tiers (packages/shared-types/src/creator-tiers.ts).
--
-- Uploading and creating channels are by invitation: a user with no row in
-- creator_tier_assignments has no tier and can do neither. Videos-side data,
-- never Auth RBAC. The videos "Super Admin" role is always Unlimited and needs
-- no row. Read on every upload initiation and channel create (no cache), so an
-- assignment or a removal takes effect at once.
--
-- 0009: 0007 and 0008 are taken by open PRs (#605, #601).

-- Tier definitions, editable by admins in the videos admin. unlimited = 1
-- ignores every limit; max_channels NULL = no channel limit.
CREATE TABLE IF NOT EXISTS creator_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unlimited INTEGER NOT NULL DEFAULT 0,
  per_hour INTEGER NOT NULL,
  per_day INTEGER NOT NULL,
  max_concurrent INTEGER NOT NULL,
  max_channels INTEGER,
  updated_at TEXT,
  updated_by TEXT
) WITHOUT ROWID;

INSERT OR IGNORE INTO creator_tiers (id, name, unlimited, per_hour, per_day, max_concurrent, max_channels)
VALUES ('creator', 'Creator', 0, 300, 2000, 20, 3),
       ('unlimited', 'Unlimited', 1, 0, 0, 0, NULL);

-- One tier per user. source = 'admin' (assigned in the videos admin) or
-- 'subscription' (granted by a paid plan, later).
CREATE TABLE IF NOT EXISTS creator_tier_assignments (
  user_id TEXT PRIMARY KEY,
  tier_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'subscription')),
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_creator_tier_assignments_tier ON creator_tier_assignments (tier_id);

-- Upload-limit refusals, for the admin's Creators page notice ("raise a limit").
-- Pruned after 30 days by the daily cron.
CREATE TABLE IF NOT EXISTS upload_limit_hits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  tier_id TEXT,
  hit_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_upload_limit_hits_user ON upload_limit_hits (user_id, hit_at);
CREATE INDEX IF NOT EXISTS idx_upload_limit_hits_at ON upload_limit_hits (hit_at);
