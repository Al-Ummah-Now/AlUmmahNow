-- Push device registry (Epic 9.4). One row per app install (install_id is the
-- client-generated id, regenerated on reinstall). Written by api-videos
-- (PUT/DELETE /api/v1/devices/:installId); read by the push fan-out.
-- token: APNs/FCM device token, WNS channel URI, or the Web Push subscription JSON.
-- categories: JSON array narrowing this device to some notification categories
-- (e.g. a TV that only wants "live"); NULL = every category the user enabled.

CREATE TABLE IF NOT EXISTS push_devices (
  install_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apns', 'fcm', 'wns', 'webpush')),
  token TEXT NOT NULL,
  locale TEXT,
  app_version TEXT,
  categories TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id, updated_at DESC);
-- A push token belongs to one install: re-registering it elsewhere moves it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(provider, token);
