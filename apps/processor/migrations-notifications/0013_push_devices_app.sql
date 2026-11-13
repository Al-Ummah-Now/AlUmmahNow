-- Which app registered the device (#1264, wiki AUN-ADMIN-NATIVE F1). APNs needs the
-- topic (bundle id) of the app that owns the token, and review alerts go only to the
-- staff Admin app. Old clients send no app: they are the viewer app.
-- No new index: every read is by user_id (idx_push_devices_user) or install_id, and the
-- app filter runs on those few rows (at most 20 per user).
ALTER TABLE push_devices ADD COLUMN app TEXT NOT NULL DEFAULT 'viewer' CHECK (app IN ('viewer', 'studio', 'admin'));
