-- Review alerts for the native Admin app (#1265, wiki AUN-ADMIN-NATIVE "Measured"). One row
-- per held review item: who was alerted and when the item was held, alerted, escalated,
-- opened, claimed and decided. Written only by the processor's review-alerts consumer; admin-api
-- reads the timings through the processor (GET /internal/review-alerts/stats).
-- alerted_users: JSON array of the user ids pushed so far (the silent "clear" goes to them).
-- Retention: 400 days (scheduled purge).
CREATE TABLE IF NOT EXISTS review_alerts (
  review_id TEXT PRIMARY KEY,
  video_id TEXT,
  reason TEXT NOT NULL,
  senior_only INTEGER NOT NULL DEFAULT 0,
  deadline_at INTEGER,
  held_at INTEGER NOT NULL,
  alerted_at INTEGER,
  escalated_at INTEGER,
  seniors_at INTEGER,
  opened_at INTEGER,
  opened_by TEXT,
  claimed_at INTEGER,
  claimed_by TEXT,
  decided_at INTEGER,
  alerted_users TEXT NOT NULL DEFAULT '[]'
);

-- The daily timings (median / p90 per day) and the retention purge read by held_at range.
-- held_at is written once per hold, so this index costs one extra write per held item.
CREATE INDEX IF NOT EXISTS idx_review_alerts_held ON review_alerts(held_at);
