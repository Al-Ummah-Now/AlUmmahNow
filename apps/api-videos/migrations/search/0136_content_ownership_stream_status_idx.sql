-- Composite index for the Event Calendar pre-E17 stream fallback query (Epic 22, E22-S3).
-- Covers: WHERE kind = 'stream' AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1 AND status IN ('live', 'scheduled') ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_content_ownership_kind_status_created
  ON content_ownership (kind, status, is_public, is_deleted, is_hidden, created_at DESC);
