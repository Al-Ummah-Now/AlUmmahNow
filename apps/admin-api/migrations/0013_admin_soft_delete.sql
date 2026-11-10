-- Soft delete for admin deletes owned by this database (packages/shared-types/src/admin-trash.ts):
-- an admin delete sets deleted_at/deleted_by/delete_reason and hides the row everywhere; it can be
-- restored for 30 days. "Delete permanently now" only sets purge_requested_at/by. The admin-api
-- cleanup (src/lib/trash.ts, hourly on the 5-minute cron) is the only code that deletes these rows
-- (and a theme's R2 files) for good.
-- Expand-only: new nullable columns and partial indexes; code that ignores them keeps working.

ALTER TABLE contact_messages ADD COLUMN deleted_at TEXT;
ALTER TABLE contact_messages ADD COLUMN deleted_by TEXT;
ALTER TABLE contact_messages ADD COLUMN delete_reason TEXT;
ALTER TABLE contact_messages ADD COLUMN purge_requested_at TEXT;
ALTER TABLE contact_messages ADD COLUMN purge_requested_by TEXT;
CREATE INDEX IF NOT EXISTS idx_contact_messages_deleted ON contact_messages (deleted_at) WHERE deleted_at IS NOT NULL;

ALTER TABLE theme_packages ADD COLUMN deleted_at TEXT;
ALTER TABLE theme_packages ADD COLUMN deleted_by TEXT;
ALTER TABLE theme_packages ADD COLUMN delete_reason TEXT;
ALTER TABLE theme_packages ADD COLUMN purge_requested_at TEXT;
ALTER TABLE theme_packages ADD COLUMN purge_requested_by TEXT;
-- Set by the cleanup before it removes the theme's R2 files: from then on it cannot be restored, and
-- a purge interrupted half way is finished by the next run.
ALTER TABLE theme_packages ADD COLUMN purge_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_theme_packages_deleted ON theme_packages (deleted_at) WHERE deleted_at IS NOT NULL;
