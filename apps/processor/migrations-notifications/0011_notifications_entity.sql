-- api-videos admin service deletes a video's notifications with
--   DELETE FROM notifications WHERE entity_id = ?
-- entity_id was not indexed, so every video delete read the whole table
-- (~19k rows per delete on QA, 77M rows read on 2026-11-12).
-- Expand-only: a new index, no table or data change.
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications (entity_id) WHERE entity_id IS NOT NULL;
