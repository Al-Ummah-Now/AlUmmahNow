-- The file an imported video came from is read by the video (failed videos, the Imports link of a video):
-- one index, so those reads never walk the table. Expand-only.
CREATE INDEX IF NOT EXISTS idx_import_items_video ON import_items (video_id) WHERE video_id IS NOT NULL;
