-- Index only public, active streams in the same order as the Event Calendar fallback.
CREATE INDEX IF NOT EXISTS idx_content_ownership_kind_status_created
  ON content_ownership (kind, created_at DESC, id)
  WHERE kind = 'stream' AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1
    AND status IN ('live', 'scheduled');
