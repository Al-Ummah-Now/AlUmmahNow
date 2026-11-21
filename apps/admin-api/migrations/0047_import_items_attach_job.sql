-- Admin Tools sidecars (wiki TOOLS-ADMIN TA-6): the api-videos admin job ('import.attach') that puts an
-- imported file's captions, chapters, thumbnail, playlist and publish date on its video, so the Imports
-- view links the item to its job. Expand-only: one nullable column.
ALTER TABLE import_items ADD COLUMN attach_job_id TEXT;
