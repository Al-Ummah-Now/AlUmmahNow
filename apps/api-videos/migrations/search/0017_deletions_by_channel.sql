-- Studio's Recently deleted lists one channel's soft-deleted videos
-- (lib/admin/deletions.ts listChannelDeletions). Expand-only: one index.
CREATE INDEX IF NOT EXISTS idx_admin_deletions_channel ON admin_deletions (kind, channel_id, purged_at, deleted_at);
