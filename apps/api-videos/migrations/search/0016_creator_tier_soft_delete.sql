-- Soft delete for creator tiers (packages/shared-types/src/admin-trash.ts): an admin delete sets
-- deleted_at/deleted_by/delete_reason; the tier disappears from the tier list and cannot be
-- assigned, and can be restored for 30 days. "Delete permanently now" only sets
-- purge_requested_at/by. The admin-api cleanup (hourly) purges through
-- POST /internal/admin/creator-tiers/purge, the only code that deletes a tier row.
-- Expand-only: new nullable columns and a partial index.
--
-- 0016: 0012-0015 are taken by open PRs.

ALTER TABLE creator_tiers ADD COLUMN deleted_at TEXT;
ALTER TABLE creator_tiers ADD COLUMN deleted_by TEXT;
ALTER TABLE creator_tiers ADD COLUMN delete_reason TEXT;
ALTER TABLE creator_tiers ADD COLUMN purge_requested_at TEXT;
ALTER TABLE creator_tiers ADD COLUMN purge_requested_by TEXT;
CREATE INDEX IF NOT EXISTS idx_creator_tiers_deleted ON creator_tiers (deleted_at) WHERE deleted_at IS NOT NULL;
