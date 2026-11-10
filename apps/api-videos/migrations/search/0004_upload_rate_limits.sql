-- Upload rate limits (docs/architecture/SCALABILITY-AUDIT.md, AV-14).
--
-- Replaces the RATE_LIMIT_KV JSON state, whose get → put let parallel requests
-- all pass, whose put contention failed open, and whose `concurrent` counter
-- leaked slots until a 25 h lockout. middleware/rate-limit.ts checks and
-- counts a request in one D1 transaction (a batch), so parallel requests are
-- serialised: of N at once exactly as many as the limits allow are counted.

-- One row per user, operation and period ('minute' | 'hour' | 'day').
-- window_start is the start of the current fixed window (epoch seconds,
-- aligned to the window length); a request in a later window starts over.
CREATE TABLE IF NOT EXISTS upload_rate_windows (
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  period TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, operation, period)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_upload_rate_windows_start ON upload_rate_windows (window_start);

-- A request in progress holds a lease (the old `concurrent` counter). The
-- request deletes it when it finishes; a lease whose request never finished
-- (isolate killed) expires instead of locking the user out.
CREATE TABLE IF NOT EXISTS upload_rate_leases (
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, operation, lease_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_upload_rate_leases_expires ON upload_rate_leases (expires_at);
