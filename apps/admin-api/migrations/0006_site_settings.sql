-- Site-wide settings managed from the admin site. An unset key means the code default.
CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Append-only: one row per change.
CREATE TABLE IF NOT EXISTS site_settings_log (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_settings_log_key ON site_settings_log (key, created_at);
