-- Caption minutes (AUN-CAPTIONS §6; packages/shared-types/src/caption-minutes.ts).
--
-- On-demand transcription and translation spend caption minutes. A creator's
-- monthly allowance is their tier's caption_minutes_month plus the admin's
-- grants for that month; "until used" grants are spent after the allowance.
-- Unlimited tiers ignore the allowance. Videos-side data, never Auth RBAC.

-- 0 = no minutes from the tier (the shipped tiers start there; admins set it)
ALTER TABLE creator_tiers ADD COLUMN caption_minutes_month INTEGER NOT NULL DEFAULT 0;

-- Grants in the videos admin (user page), each with a reason; revoked, never deleted
CREATE TABLE IF NOT EXISTS caption_minute_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  scope TEXT NOT NULL CHECK (scope IN ('month', 'until_used')),
  -- YYYY-MM for a month grant; NULL for until_used
  period TEXT,
  -- Minutes of an until_used grant reserved or charged
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_caption_minute_grants_user ON caption_minute_grants (user_id, created_at);

-- Minutes of a month's allowance reserved or charged, per subject (the tier holder)
CREATE TABLE IF NOT EXISTS caption_minute_usage (
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, period)
) WITHOUT ROWID;

-- One reservation per job: what it took from the month and from each grant,
-- so a commit or a refund gives back exactly that (and only once)
CREATE TABLE IF NOT EXISTS caption_minute_holds (
  hold_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  month_minutes INTEGER NOT NULL,
  -- [{"grantId": "...", "minutes": n}]
  packs_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  charged INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_caption_minute_holds_user ON caption_minute_holds (user_id, period);
