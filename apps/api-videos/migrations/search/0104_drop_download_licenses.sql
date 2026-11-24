-- Epic 14 (owner decision E14-D1): downloads are plain progressive media files with no encryption or licenses.
-- Drops the unused download_licenses table and its indexes added in 0079.
DROP INDEX IF EXISTS idx_download_licenses_video_status;
DROP INDEX IF EXISTS idx_download_licenses_user_device;
DROP INDEX IF EXISTS idx_download_licenses_user_status;
DROP TABLE IF EXISTS download_licenses;
