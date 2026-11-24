-- Account events from Auth (AlUmmahNowAuth docs/account-hub/SPEC.md §5.4, AlUmmahNowAuth#507 C3). Expand only.
-- account_event_status (age rules) holds when the last valid one arrived.
-- 1. Every event received, by its jti (a repeat does nothing). A user id and a type; never an email, a name or an age.
CREATE TABLE IF NOT EXISTS account_events_received (
  jti TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'applied', 'ignored', 'failed')),
  -- where a resumable action goes on
  progress TEXT,
  error TEXT,
  received_at INTEGER NOT NULL,
  queued_at INTEGER,
  settled_at INTEGER
) WITHOUT ROWID;
-- Not done yet, by when last queued (the hourly sweep), and settled ones by age (clean-up)
CREATE INDEX IF NOT EXISTS idx_account_events_received_open ON account_events_received (queued_at) WHERE status = 'received';
CREATE INDEX IF NOT EXISTS idx_account_events_received_settled ON account_events_received (status, settled_at);

-- 2. Per account: the newest event applied (an older one is ignored; nothing follows a purge), and who works on it now.
CREATE TABLE IF NOT EXISTS account_event_users (
  user_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  jti TEXT NOT NULL,
  type TEXT NOT NULL,
  purged INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
