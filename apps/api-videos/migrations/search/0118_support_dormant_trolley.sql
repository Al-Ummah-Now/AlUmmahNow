-- Creator support, owner decisions of 2026-11-23 (wiki AUN-MEMBERS).
--
-- MEM-D22: unclaimed balances go to the Waqf after the reminders (3, 6, 12 months). The transfer is
-- its own ledger kind, 'dormant_transfer', so it stands apart in the audit; the reminders and the
-- transfers are recorded below. MEM-D17: Trolley is a payout rail.
--
-- SQLite can't change a CHECK in place, so support_ledger and support_payees are rebuilt with their
-- rows, indexes and (for the ledger) the append-only triggers. Support is off everywhere, so both
-- are empty or hold test rows only.

-- support_ledger: + 'dormant_transfer'
CREATE TABLE support_ledger_v2 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  entry_id TEXT NOT NULL,
  -- Idempotency of the whole entry: the same key never posts twice
  entry_key TEXT NOT NULL,
  account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gift', 'collector_fee', 'settlement', 'release', 'refund', 'dispute', 'dispute_fee', 'dispute_reversal', 'payout', 'payout_paid', 'payout_fee', 'payout_return', 'rail_funding', 'fx', 'adjustment', 'write_off', 'dormant_transfer')),
  ref_table TEXT,
  ref_id TEXT,
  channel_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO support_ledger_v2 (seq, id, entry_id, entry_key, account, amount, currency, kind, ref_table, ref_id, channel_id, created_by, created_at)
  SELECT seq, id, entry_id, entry_key, account, amount, currency, kind, ref_table, ref_id, channel_id, created_by, created_at FROM support_ledger;
DROP TRIGGER IF EXISTS support_ledger_no_update;
DROP TRIGGER IF EXISTS support_ledger_no_delete;
DROP TABLE support_ledger;
ALTER TABLE support_ledger_v2 RENAME TO support_ledger;
CREATE INDEX IF NOT EXISTS idx_support_ledger_entry ON support_ledger (entry_id);
CREATE INDEX IF NOT EXISTS idx_support_ledger_key ON support_ledger (entry_key);
CREATE INDEX IF NOT EXISTS idx_support_ledger_account ON support_ledger (account, currency);
CREATE INDEX IF NOT EXISTS idx_support_ledger_channel ON support_ledger (channel_id, seq) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_ledger_ref ON support_ledger (ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_support_ledger_created ON support_ledger (created_at);
CREATE TRIGGER IF NOT EXISTS support_ledger_no_update BEFORE UPDATE ON support_ledger BEGIN SELECT RAISE(ABORT, 'support_ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS support_ledger_no_delete BEFORE DELETE ON support_ledger BEGIN SELECT RAISE(ABORT, 'support_ledger is append-only'); END;

-- support_payees: + 'trolley'
CREATE TABLE support_payees_v2 (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('wise', 'paypal-payouts', 'trolley', 'test')),
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  rail_payee_ref TEXT,
  country TEXT,
  payout_currency TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'pending', 'action_needed', 'active', 'restricted', 'disabled', 'closed')),
  tax_form TEXT NOT NULL DEFAULT 'none' CHECK (tax_form IN ('none', 'w9', 'w8ben', 'w8bene')),
  sanctions_status TEXT NOT NULL DEFAULT 'pending' CHECK (sanctions_status IN ('clear', 'pending', 'hold')),
  -- JSON array of requirement codes the rail still needs
  requirements TEXT NOT NULL DEFAULT '[]',
  payouts_held INTEGER NOT NULL DEFAULT 0 CHECK (payouts_held IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_from_event_at TEXT
) WITHOUT ROWID;
INSERT INTO support_payees_v2 (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, payout_currency, method, status, tax_form, sanctions_status, requirements, payouts_held, created_at, updated_at, updated_from_event_at)
  SELECT id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, payout_currency, method, status, tax_form, sanctions_status, requirements, payouts_held, created_at, updated_at, updated_from_event_at FROM support_payees;
DROP TABLE support_payees;
ALTER TABLE support_payees_v2 RENAME TO support_payees;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payees_channel ON support_payees (channel_id, rail, mode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payees_ref ON support_payees (rail, mode, rail_payee_ref) WHERE rail_payee_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_payees_owner ON support_payees (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_support_payees_status ON support_payees (status, updated_at);

-- MEM-D22 reminders: one row per channel, unclaimed period (cycle_start = its oldest unclaimed gift) and
-- reminder month. 'due' until the reminder is delivered ('sent'); the transfer waits for every reminder.
CREATE TABLE IF NOT EXISTS support_dormant_notices (
  channel_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  months INTEGER NOT NULL CHECK (months > 0),
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'sent')),
  created_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (channel_id, cycle_start, months)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_dormant_notices_due ON support_dormant_notices (status, created_at);

-- MEM-D22 transfers to the Waqf (the ledger holds the money; this row is the audit trail and starts a new period)
CREATE TABLE IF NOT EXISTS support_dormant_transfers (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  cycle_start TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  entry_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_dormant_transfers_channel ON support_dormant_transfers (channel_id, created_at);
