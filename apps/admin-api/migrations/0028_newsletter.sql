-- Newsletter (AlUmmahNowUI#6, wiki CMS-QUEUE): double opt-in subscribers from the www sign-up form,
-- issues written in the videos admin, and one delivery row per issue and subscriber.
-- Endpoints: admin-api endpoints/newsletter (www's server, X-API-Key) and routers/newsletter.router.ts
-- (newsletter:manage). Mail goes through CONTACT_MAIL_QUEUE (lib/newsletter-mail.ts).

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  -- Lowercased
  email TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ar')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  -- SHA-256 of the emailed confirmation token (the token itself is never stored)
  confirm_token_hash TEXT,
  confirm_expires_at TEXT,
  confirm_sent_at TEXT,
  -- Confirmation email: queued | sent | sunk | failed
  confirm_status TEXT,
  confirm_error TEXT,
  -- In every issue's unsubscribe link and List-Unsubscribe header
  unsubscribe_token TEXT NOT NULL UNIQUE,
  -- Keyed hash of the last sign-up request's IP (rate limit only)
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_status ON newsletter_subscribers (status, id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_confirm ON newsletter_subscribers (confirm_token_hash);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_ip ON newsletter_subscribers (ip_hash, updated_at);

CREATE TABLE IF NOT EXISTS newsletter_issues (
  id TEXT PRIMARY KEY,
  subject_en TEXT NOT NULL DEFAULT '',
  subject_ar TEXT NOT NULL DEFAULT '',
  body_en TEXT NOT NULL DEFAULT '',
  body_ar TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'sending', 'sent')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_by TEXT,
  send_started_at TEXT,
  -- Every confirmed subscriber has a delivery row (the fan-out finished)
  fanned_out_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsletter_issues_created ON newsletter_issues (created_at);

CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  issue_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  -- queued | sent | sunk | skipped (unsubscribed before it went out) | failed
  status TEXT NOT NULL,
  provider_id TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_status ON newsletter_deliveries (issue_id, status);
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_subscriber ON newsletter_deliveries (subscriber_id);
