-- Feature switches (FEAT-4, wiki AUN-FEATURES §5.3, decision O39).
--
-- One row per switch the videos admin Features page has changed. With no row, a switch follows its
-- old setting (the R2 JSON `enabled` fields, the categorize visibility file) or the registry default
-- (packages/shared-types/src/feature-registry.ts). The first write of a key creates its row; from
-- then on the old setting is no longer read. `version` guards concurrent writes (409 feature_changed).
CREATE TABLE IF NOT EXISTS feature_switches (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- Every change, for the page's history and Undo. old_enabled NULL: the old setting or default was in force.
CREATE TABLE IF NOT EXISTS feature_switch_changes (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  -- The switch's version after this change: a key's history is ordered and paged by it
  version INTEGER NOT NULL,
  old_enabled INTEGER CHECK (old_enabled IS NULL OR old_enabled IN (0, 1)),
  new_enabled INTEGER NOT NULL CHECK (new_enabled IN (0, 1)),
  actor_id TEXT NOT NULL,
  -- legacy_page: an old settings page's own toggle, until the Features page replaces it
  source TEXT NOT NULL CHECK (source IN ('features_page', 'undo', 'legacy_page', 'migration')),
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS feature_switch_changes_key ON feature_switch_changes (key, version);

-- "Allow tier requests" moves here as the tierRequests switch (it already lived in this database).
INSERT OR IGNORE INTO feature_switches (key, enabled, version, updated_by, updated_at)
SELECT 'tierRequests', CASE WHEN value = '1' THEN 1 ELSE 0 END, 1, COALESCE(updated_by, 'system:migration'), COALESCE(updated_at, '2026-11-22T00:00:00.000Z')
FROM creator_tier_settings WHERE key = 'tier_requests_enabled';
