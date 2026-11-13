-- Own domains of white-label sites (wiki AUN-SCHOLAR-SITES §4.2, #1212): the status checks to run.
-- One row per own domain being set up or live; the cron reads only rows that are due (indexed),
-- every 10 minutes for 72 hours after adding, then daily. The domain's state lives in api-videos.
CREATE TABLE IF NOT EXISTS site_domain_checks (
  host TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  cf_id TEXT,
  added_at TEXT NOT NULL,
  next_check_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_domain_checks_due ON site_domain_checks (next_check_at);
