-- Status page subscriptions (docs/status-page/README.md "Subscriptions").
-- The status Worker writes email subscribers (public form, double opt-in); admin-api writes
-- webhooks (videos admin), notifications and deliveries (its status notify queue consumer).

-- Email subscribers and webhooks. Unsubscribing deletes the row (and its deliveries), so an
-- address is kept only while it is subscribed or waiting for confirmation.
CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'webhook')),
  -- email: the lower-cased address; webhook: its https URL
  address TEXT NOT NULL,
  -- The one language of an email subscriber's mail (webhooks carry both)
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  -- Webhooks: the admin's label
  name TEXT,
  -- pending: email waiting for its confirmation click (deleted after 7 days); active: receives updates
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  -- Email: the random token in its confirm and unsubscribe links. Kept as is because every email
  -- carries the unsubscribe link; it controls only this one subscription
  token TEXT UNIQUE,
  -- Webhooks: the HMAC-SHA256 signing secret (shown to the admin once)
  secret TEXT,
  created_at TEXT NOT NULL,
  -- Webhooks: the admin who added it
  created_by TEXT,
  confirmed_at TEXT,
  -- Email: when the last confirmation email was queued (resend cooldown)
  confirm_sent_at TEXT,
  UNIQUE (kind, address)
);
CREATE INDEX subscribers_status ON subscribers (status, kind);

-- One row per incident post or update that was announced (id = the incident_updates row)
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('created', 'updated', 'resolved')),
  created_at TEXT NOT NULL,
  -- Set once every active subscriber got a delivery row and a queued job
  fanned_out_at TEXT,
  recipients INTEGER
);
CREATE INDEX notifications_created ON notifications (created_at);

-- One row per notification per subscriber: what happened to it
CREATE TABLE deliveries (
  notification_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  -- queued | sent | sunk (an E2E address outside production) | skipped (subscriber gone) | failed (gave up, flagged)
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'sunk', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (notification_id, subscriber_id)
);
CREATE INDEX deliveries_subscriber ON deliveries (subscriber_id);
CREATE INDEX deliveries_status ON deliveries (notification_id, status);

-- Subscribe form rate limit: requests per keyed hash of the IP per hour (no IPs stored)
CREATE TABLE subscribe_limits (
  key TEXT PRIMARY KEY,
  hour TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX subscribe_limits_hour ON subscribe_limits (hour);
