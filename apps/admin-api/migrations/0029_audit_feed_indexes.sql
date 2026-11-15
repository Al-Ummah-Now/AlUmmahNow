-- The admin-wide Audit page (issue #711) reads site_settings_log and
-- admin_audit_log newest first, optionally for one actor. Without these the
-- feed sorted the whole site_settings_log on every page.
-- Expand-only: new indexes, no table or data change.
CREATE INDEX IF NOT EXISTS idx_site_settings_log_created ON site_settings_log (created_at, id);
CREATE INDEX IF NOT EXISTS idx_site_settings_log_actor ON site_settings_log (actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log (actor_id, created_at);
