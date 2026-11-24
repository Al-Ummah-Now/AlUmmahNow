-- Processing health & thumbnail runs list indexes (avoid R2 bucket scans and temp B-tree sorts).
--
-- 1. GET /internal/processing/videos (and /errors): seeks non-ready videos by
--    (kind, upload_status, is_deleted) already ordered newest-first by
--    (COALESCE(created_at, 0), id), skipping soft-deleted/abandoned uploads.
-- 2. GET /internal/processing/thumbnails (listJobs by target): covers
--    ORDER BY created_at DESC, id DESC without a temp B-tree sort.
--
-- Expand-only: two new indexes.
CREATE INDEX IF NOT EXISTS idx_content_ownership_upload_created
  ON content_ownership (kind, upload_status, is_deleted, COALESCE(created_at, 0), id);

CREATE INDEX IF NOT EXISTS idx_admin_jobs_target_id
  ON admin_jobs (target_kind, target_id, created_at, id);
