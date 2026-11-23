-- Creator support fee schedules (wiki AUN-MEMBERS O43, owner 2026-11-23: "we need to be able to change the fee
-- if there are changes in terms"). The collector's fee and the payout rail's fee per currency and payment method,
-- with the date each applies from. Rows are never edited: a change is a new row, and the newest row already in
-- force applies (so the history is the audit trail too). A vendor's live quote wins over these; they are the fallback.
CREATE TABLE IF NOT EXISTS support_fee_schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('collector', 'rail')),
  provider TEXT NOT NULL,
  currency TEXT NOT NULL,
  method TEXT,
  basis_points INTEGER NOT NULL CHECK (basis_points >= 0 AND basis_points <= 2000),
  fixed_minor INTEGER NOT NULL CHECK (fixed_minor >= 0),
  effective_from TEXT NOT NULL,
  preset_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_fee_schedules_current ON support_fee_schedules (kind, provider, currency, effective_from);
CREATE TRIGGER IF NOT EXISTS support_fee_schedules_no_update BEFORE UPDATE ON support_fee_schedules BEGIN SELECT RAISE(ABORT, 'support_fee_schedules is append-only'); END;
CREATE TRIGGER IF NOT EXISTS support_fee_schedules_no_delete BEFORE DELETE ON support_fee_schedules BEGIN SELECT RAISE(ABORT, 'support_fee_schedules is append-only'); END;
