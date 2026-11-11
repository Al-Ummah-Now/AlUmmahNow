-- Warnings to videos users (warn-user feature). Expand-only: one new table.
--
-- A moderator, admin or super admin warns a user (content permission
-- users:warn). Each warning is one row; the user's history and count are read
-- from it (newest first). The audit row goes to site_settings_log as for every
-- content action (content:user:<id>, action warn). The user is told in-app
-- (api-videos notification accountWarning) and by email (contact mail queue),
-- whose outcome is kept here.
CREATE TABLE IF NOT EXISTS user_warnings (
    id TEXT PRIMARY KEY,                  -- wrn_ + 32 hex
    user_id TEXT NOT NULL,                -- the videos user (usr_…)
    reason_code TEXT NOT NULL,            -- moderation reason (ReportReason)
    note TEXT,                            -- moderator's note, never shown to the user
    report_id TEXT,                       -- the report it came from, if any
    entity_kind TEXT,                     -- the content it is about, if any
    entity_id TEXT,
    issued_by TEXT NOT NULL,              -- staff user id
    issued_by_name TEXT NOT NULL,         -- their name (or email) when they issued it
    created_at TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),  -- the one email language chosen when warning (a Retry resends in it)
    in_app_sent INTEGER NOT NULL DEFAULT 0,
    email_status TEXT,                    -- queued | sent | sunk | disabled | no_address | failed
    email_error TEXT,
    email_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON user_warnings(user_id, created_at DESC, id DESC);
