-- Social auto-post and scheduler-tool support (wiki AUN-SOCIAL, SOC-1). Owned by api-videos; the processor
-- drives the queue, admin-api reads and writes the platform settings through /internal/social.
-- Tokens and webhook secrets are AES-256-GCM ciphertext (SOCIAL_TOKEN_KEK), never plain text.

-- One connected account on one network, attached to one channel.
CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  network TEXT NOT NULL,                 -- x | telegram | bluesky | mastodon
  remote_id TEXT NOT NULL,               -- X user id, Telegram chat id, Bluesky DID, Mastodon account id
  handle TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  instance TEXT,                         -- Mastodon instance host, Bluesky PDS origin
  language TEXT NOT NULL DEFAULT 'en',   -- template and title language of its posts
  status TEXT NOT NULL DEFAULT 'active', -- active | needs_reconnect | revoked | suspended
  status_reason TEXT,
  token_ciphertext TEXT,                 -- encrypted JSON of the network's tokens (null for Telegram)
  token_expires_at INTEGER,              -- ms; when the access token needs a refresh
  refresh_lease_until INTEGER,           -- ms; one refresh at a time (rotating refresh tokens)
  connected_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (channel_id, network, remote_id)
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_channel ON social_accounts (channel_id);

-- What an account posts automatically, per event (new video, Short, live, post).
CREATE TABLE IF NOT EXISTS social_rules (
  account_id TEXT NOT NULL,
  event TEXT NOT NULL,                   -- video | short | live | post
  enabled INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'video',  -- video | link
  include_link INTEGER NOT NULL DEFAULT 0, -- X video posts: add the watch link (billed as a link post)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, event)
);

-- The channel's post templates, per event and language.
CREATE TABLE IF NOT EXISTS social_templates (
  channel_id TEXT NOT NULL,
  event TEXT NOT NULL,
  lang TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, event, lang)
);

-- One post of one event to one account. Unique per account and entity: an event announced twice posts once.
CREATE TABLE IF NOT EXISTS social_deliveries (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  network TEXT NOT NULL,
  event TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_title TEXT,
  format TEXT NOT NULL,
  include_link INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                  -- queued | sending | sent | failed | blocked | cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  remote_id TEXT,
  remote_url TEXT,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE (account_id, event, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_social_deliveries_channel ON social_deliveries (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_deliveries_status ON social_deliveries (status, updated_at);

-- Outgoing webhooks (Zapier, Make, n8n …), per channel.
CREATE TABLE IF NOT EXISTS social_webhooks (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  events TEXT NOT NULL,                  -- comma-separated SocialWebhookEvent
  enabled INTEGER NOT NULL DEFAULT 1,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_delivery_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_webhooks_channel ON social_webhooks (channel_id);

CREATE TABLE IF NOT EXISTS social_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  event TEXT NOT NULL,                   -- SocialWebhookEvent
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,                  -- queued | sending | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (webhook_id, event, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_social_webhook_deliveries_hook ON social_webhook_deliveries (webhook_id, created_at DESC);

-- Paid API spend per month (X), against the admin's cap.
CREATE TABLE IF NOT EXISTS social_spend (
  month TEXT NOT NULL,                   -- YYYY-MM (UTC)
  network TEXT NOT NULL,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  posts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, network)
);

-- Platform settings (kill switches, X cap) and platform credentials (encrypted), by key.
CREATE TABLE IF NOT EXISTS social_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

-- Mastodon apps registered per instance (client secret encrypted).
CREATE TABLE IF NOT EXISTS social_instance_apps (
  instance TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- In-flight connections: OAuth state (PKCE verifier and DPoP key encrypted) and Telegram link codes. 10–30 minutes.
CREATE TABLE IF NOT EXISTS social_pending (
  id TEXT PRIMARY KEY,                   -- OAuth state, or the Telegram code
  kind TEXT NOT NULL,                    -- oauth | telegram
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  network TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  data_ciphertext TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_pending_expires ON social_pending (expires_at);

-- Studio actions on a channel's social setup (connect, disconnect, rules, templates, webhooks).
CREATE TABLE IF NOT EXISTS social_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_audit_channel ON social_audit (channel_id, created_at DESC);
