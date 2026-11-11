-- Email preferences per user (warn-user feature). Expand-only: one new table.
-- Written by api-videos (PUT /api/notifications/settings), read by it for
-- admin-api's account emails (GET /internal/admin/users/:id/account-email).
-- A missing row means the defaults: account emails on, language not picked
-- (emails then go in English).
CREATE TABLE IF NOT EXISTS notification_email_prefs (
  user_id TEXT PRIMARY KEY,
  account_email INTEGER NOT NULL DEFAULT 1,                -- "Email me about my account"
  email_locale TEXT CHECK (email_locale IN ('en', 'ar')),  -- NULL = not picked
  updated_at INTEGER NOT NULL
);
