-- The admin user picker (lib/admin/userSearch.ts) finds a user by exact email, @handle or id, and a
-- channel's owner by its @handle, through these indexes instead of scanning every profile and
-- channel row (30k profiles / 17k channels on QA: ~200 ms of D1 time per keystroke, which queued
-- into 500s under parallel load, 2026-11-12). Expand-only: two expression indexes.
CREATE INDEX IF NOT EXISTS idx_content_ownership_email_lower ON content_ownership (kind, lower(email));
CREATE INDEX IF NOT EXISTS idx_content_ownership_handle_lower ON content_ownership (kind, lower(handle));
