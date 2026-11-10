-- Videos whose Short/video format cannot be decided (packages/shared-types
-- src/video-format-ops.ts): no duration or encoded dimensions even after the
-- format job re-read Bunny, and no choice by the uploader. Admins list them
-- (admin-api /api/admin/video-format/flagged) and set the format by hand.
--
-- Expand-only: 0 for every existing row; set by every later write of a video.
ALTER TABLE content_ownership ADD COLUMN needs_format INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_content_ownership_needs_format ON content_ownership (kind, needs_format, created_at);
