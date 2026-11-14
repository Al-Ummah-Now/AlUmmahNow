-- Caption minutes overdraft and ledger (AUN-CAPTIONS §6.3.1; owner decisions 2026-11-14:
-- "when mins end, complete the running video and they get a negative balance" and
-- "balance updates before job finishes").
--
-- A job is charged its estimate when it starts, from the month's allowance, then
-- "until used" grants, then this overdraft (the balance goes negative). A start needs a
-- balance above 0. The overdraft is paid down by the next month's allowance and by grants.

-- Minutes charged past the allowance and grants, per subject (the tier holder)
CREATE TABLE IF NOT EXISTS caption_minute_overdraft (
  user_id TEXT PRIMARY KEY,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- One row per balance change, written in the same batch as the change. The id is the
-- step's idempotency key (`<jobId>:start|settle|cancel|refund`, `paydown:<uuid>`), so a
-- retried step never charges twice. minutes: + charged, - given back; paydown: overdraft
-- paid from the allowance or a grant (the balance itself is unchanged).
CREATE TABLE IF NOT EXISTS caption_minute_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  hold_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'settle', 'cancel', 'refund', 'paydown')),
  minutes INTEGER NOT NULL,
  -- The balance after this step; NULL when unlimited
  balance_after INTEGER,
  period TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_caption_minute_ledger_user ON caption_minute_ledger (user_id, created_at);
