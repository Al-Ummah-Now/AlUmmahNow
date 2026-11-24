-- Account erasure finds the reports whose decision banned the person (processor erasure/reports.ts).
CREATE INDEX IF NOT EXISTS idx_reports_banned_user ON reports(banned_user_id) WHERE banned_user_id IS NOT NULL;
