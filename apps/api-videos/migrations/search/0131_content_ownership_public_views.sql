-- Serve the global public video list in views order, including the ID tiebreaker.
CREATE INDEX idx_content_ownership_public_views ON content_ownership (kind, views DESC, id)
  WHERE kind = 'video' AND is_deleted = 0 AND is_hidden = 0 AND is_public = 1
    AND (upload_status IS NULL OR upload_status = 'ready');
