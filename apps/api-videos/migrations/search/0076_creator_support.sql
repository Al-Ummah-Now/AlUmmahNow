-- Supporting creators (wiki AUN-MEMBERS §9.3, Linear AUN-615 / MEM-3; shared-types support.ts).
-- Expand-only. Nothing here is used while the `creatorSupport` switch is off (the default, and it
-- stays off until the organisation exists).
--
-- Money: every amount is an INTEGER count of minor units with its ISO 4217 currency beside it.
-- Balances are never stored: they are sums over support_ledger, which can only be appended to
-- (the triggers at the end refuse UPDATE and DELETE). Corrections are new entries.
--
-- Personal data is kept to the minimum: no bank details, card data, ID documents or tax forms
-- (the collector and the payout rail hold those). Account erasure (processor user-traces.ts)
-- moves user ids to the erased placeholder, drops messages and empties webhook payloads; the
-- money rows stay as financial records.

-- Site-wide support settings (one row, id 'default'): the owner-decision policy (JSON, every value
-- null until decided), the collector fee schedule per currency, whether the organisation is formed.
CREATE TABLE IF NOT EXISTS support_config (
  id TEXT PRIMARY KEY,
  policy TEXT NOT NULL DEFAULT '{}',
  collector TEXT NOT NULL DEFAULT 'test' CHECK (collector IN ('paygood', 'test')),
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  -- {"USD":{"basisPoints":290,"fixed":30}}: the collector's published card fee, for the breakdown
  collector_fees TEXT NOT NULL DEFAULT '{}',
  organisation_formed INTEGER NOT NULL DEFAULT 0 CHECK (organisation_formed IN (0, 1)),
  organisation_name TEXT,
  -- Emergency stop (§9.7): pauses pledges, disables checkout and holds every batch
  emergency_stop INTEGER NOT NULL DEFAULT 0 CHECK (emergency_stop IN (0, 1)),
  hold_all_payouts INTEGER NOT NULL DEFAULT 0 CHECK (hold_all_payouts IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  updated_by TEXT
) WITHOUT ROWID;

-- People on the organisation's finance list (§9.6): only they can hold money permissions.
-- Never the owner, never tech staff (admin-api refuses the grant).
CREATE TABLE IF NOT EXISTS support_finance_members (
  user_id TEXT PRIMARY KEY,
  roles TEXT NOT NULL DEFAULT '[]',
  added_by TEXT NOT NULL,
  approved_by TEXT,
  added_at TEXT NOT NULL,
  removed_at TEXT
) WITHOUT ROWID;

-- A channel's own support settings
CREATE TABLE IF NOT EXISTS support_settings (
  channel_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  one_time_enabled INTEGER NOT NULL DEFAULT 1 CHECK (one_time_enabled IN (0, 1)),
  monthly_enabled INTEGER NOT NULL DEFAULT 1 CHECK (monthly_enabled IN (0, 1)),
  -- JSON array of minor units in `currency`
  presets TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'USD',
  thank_you_note TEXT,
  -- A creator may raise their payout threshold (MEM-D19 setting permitting)
  payout_threshold INTEGER,
  -- Paused by an admin (§9.7), with the reason code
  admin_paused INTEGER NOT NULL DEFAULT 0 CHECK (admin_paused IN (0, 1)),
  admin_paused_reason TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) WITHOUT ROWID;

-- The creator's payee at the payout rail
CREATE TABLE IF NOT EXISTS support_payees (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('wise', 'paypal-payouts', 'test')),
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payees_channel ON support_payees (channel_id, rail, mode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payees_ref ON support_payees (rail, mode, rail_payee_ref) WHERE rail_payee_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_payees_owner ON support_payees (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_support_payees_status ON support_payees (status, updated_at);

-- A checkout a supporter started (links the collector's webhook back to the supporter and channel)
CREATE TABLE IF NOT EXISTS support_checkouts (
  id TEXT PRIMARY KEY,
  supporter_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('one_time', 'monthly')),
  collector TEXT NOT NULL,
  mode TEXT NOT NULL,
  checkout_ref TEXT,
  gift INTEGER NOT NULL CHECK (gift > 0),
  charged INTEGER NOT NULL CHECK (charged > 0),
  currency TEXT NOT NULL,
  supporter_covers_fees INTEGER NOT NULL DEFAULT 0 CHECK (supporter_covers_fees IN (0, 1)),
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  message TEXT,
  -- The monthly-charge consent line the supporter ticked, word for word, and when (§2.1, §4.5)
  consent_text TEXT,
  consent_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired')),
  created_at TEXT NOT NULL,
  completed_at TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_checkouts_supporter ON support_checkouts (supporter_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_checkouts_ref ON support_checkouts (collector, mode, checkout_ref);

-- Monthly support
CREATE TABLE IF NOT EXISTS support_pledges (
  id TEXT PRIMARY KEY,
  supporter_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  collector TEXT NOT NULL,
  mode TEXT NOT NULL,
  collector_pledge_ref TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  supporter_covers_fees INTEGER NOT NULL DEFAULT 0 CHECK (supporter_covers_fees IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'ended')),
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  started_at TEXT NOT NULL,
  current_period_end TEXT,
  canceled_at TEXT,
  cancel_reason TEXT,
  last_event_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_pledges_ref ON support_pledges (collector, mode, collector_pledge_ref) WHERE collector_pledge_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_pledges_supporter ON support_pledges (supporter_user_id, status);
CREATE INDEX IF NOT EXISTS idx_support_pledges_channel ON support_pledges (channel_id, status);

-- A charge: one-time or a monthly renewal
CREATE TABLE IF NOT EXISTS support_payments (
  id TEXT PRIMARY KEY,
  pledge_id TEXT,
  checkout_id TEXT,
  supporter_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  collector TEXT NOT NULL,
  mode TEXT NOT NULL,
  collector_payment_ref TEXT NOT NULL,
  gross INTEGER NOT NULL,
  currency TEXT NOT NULL,
  collector_fee INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  refunded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed', 'dispute_lost', 'dispute_won')),
  -- End of the hold (MEM-D18); set when the gift is booked
  available_at TEXT,
  released_at TEXT,
  -- Private to the creator, moderated; dropped on erasure
  message TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  supporter_country TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payments_ref ON support_payments (collector, mode, collector_payment_ref);
CREATE INDEX IF NOT EXISTS idx_support_payments_channel ON support_payments (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_payments_supporter ON support_payments (supporter_user_id, created_at);
-- support.release: held gifts whose hold has ended
CREATE INDEX IF NOT EXISTS idx_support_payments_release ON support_payments (available_at) WHERE released_at IS NULL AND available_at IS NOT NULL;

-- Immutable double-entry lines. One event = one entry_id whose lines sum to zero per currency.
-- Sign convention (§9.3): money owed to a creator is negative on their accounts.
CREATE TABLE IF NOT EXISTS support_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  entry_id TEXT NOT NULL,
  -- Idempotency of the whole entry: the same key never posts twice
  entry_key TEXT NOT NULL,
  account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gift', 'collector_fee', 'settlement', 'release', 'refund', 'dispute', 'dispute_fee', 'dispute_reversal', 'payout', 'payout_paid', 'payout_fee', 'payout_return', 'rail_funding', 'fx', 'adjustment', 'write_off')),
  ref_table TEXT,
  ref_id TEXT,
  channel_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_ledger_entry ON support_ledger (entry_id);
CREATE INDEX IF NOT EXISTS idx_support_ledger_key ON support_ledger (entry_key);
CREATE INDEX IF NOT EXISTS idx_support_ledger_account ON support_ledger (account, currency);
CREATE INDEX IF NOT EXISTS idx_support_ledger_channel ON support_ledger (channel_id, seq) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_ledger_ref ON support_ledger (ref_table, ref_id);
CREATE TRIGGER IF NOT EXISTS support_ledger_no_update BEFORE UPDATE ON support_ledger BEGIN SELECT RAISE(ABORT, 'support_ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS support_ledger_no_delete BEFORE DELETE ON support_ledger BEGIN SELECT RAISE(ABORT, 'support_ledger is append-only'); END;

-- One row per posted entry: the PRIMARY KEY on entry_key makes a second post of the same event
-- fail inside the same batch, so a retried job can never post twice.
CREATE TABLE IF NOT EXISTS support_ledger_entries (
  entry_key TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  channel_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS support_ledger_entries_no_update BEFORE UPDATE ON support_ledger_entries BEGIN SELECT RAISE(ABORT, 'support_ledger_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS support_ledger_entries_no_delete BEFORE DELETE ON support_ledger_entries BEGIN SELECT RAISE(ABORT, 'support_ledger_entries is append-only'); END;

-- A proposed ledger adjustment waiting for its approvers (MEM-D24)
CREATE TABLE IF NOT EXISTS support_adjustments (
  id TEXT PRIMARY KEY,
  -- JSON array of {account, amount, currency}
  lines TEXT NOT NULL,
  reason TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  approvals TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'posted', 'rejected')),
  entry_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_adjustments_status ON support_adjustments (status, created_at);

-- Monthly (or manual) payout runs
CREATE TABLE IF NOT EXISTS support_payout_batches (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'funding', 'sending', 'done', 'stopped')),
  -- JSON object currency → total minor units
  totals TEXT NOT NULL DEFAULT '{}',
  count INTEGER NOT NULL DEFAULT 0,
  prepared_by TEXT NOT NULL,
  -- JSON array of {userId, at}; never the owner (admin-api refuses)
  approvals TEXT NOT NULL DEFAULT '[]',
  approved_at TEXT,
  funding_reference TEXT,
  stopped_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_batches_period ON support_payout_batches (period) WHERE status NOT IN ('stopped');
CREATE INDEX IF NOT EXISTS idx_support_batches_status ON support_payout_batches (status, created_at);

-- One payout to one creator. `id` is the rail's idempotency key.
CREATE TABLE IF NOT EXISTS support_payouts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  rail_fee INTEGER,
  fx_rate TEXT,
  rail_payout_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'unknown', 'paid', 'failed', 'returned', 'canceled')),
  failure_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_payouts_batch_payee ON support_payouts (batch_id, payee_id, currency);
CREATE INDEX IF NOT EXISTS idx_support_payouts_channel ON support_payouts (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_payouts_status ON support_payouts (status, updated_at);

CREATE TABLE IF NOT EXISTS support_refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL CHECK (requested_by IN ('creator', 'admin', 'collector')),
  requested_by_user TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'pending', 'succeeded', 'failed')),
  collector_refund_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_refunds_payment ON support_refunds (payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_refunds_ref ON support_refunds (collector_refund_ref) WHERE collector_refund_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_disputes (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  collector_dispute_ref TEXT NOT NULL,
  reason TEXT,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'evidence_sent', 'won', 'lost')),
  evidence_due_at TEXT,
  evidence_sent_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_disputes_ref ON support_disputes (collector_dispute_ref);
CREATE INDEX IF NOT EXISTS idx_support_disputes_due ON support_disputes (status, evidence_due_at);

-- Vendor webhook deliveries, stored once ((vendor, mode, event_id) is the idempotency key)
CREATE TABLE IF NOT EXISTS support_events (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  mode TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processed', 'ignored', 'failed')),
  error TEXT,
  user_id TEXT,
  job_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_events_key ON support_events (vendor, mode, event_id);
CREATE INDEX IF NOT EXISTS idx_support_events_status ON support_events (status, received_at);
CREATE INDEX IF NOT EXISTS idx_support_events_user ON support_events (user_id) WHERE user_id IS NOT NULL;

-- Daily three-way reconciliation (§9.1)
CREATE TABLE IF NOT EXISTS support_reconciliations (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  currency TEXT NOT NULL,
  ledger_bank INTEGER NOT NULL,
  ledger_rail INTEGER NOT NULL,
  ledger_clearing INTEGER NOT NULL,
  collector_settled INTEGER,
  bank_balance INTEGER,
  rail_balance INTEGER,
  -- Lines whose entries don't sum to zero (should always be 0)
  unbalanced_entries INTEGER NOT NULL DEFAULT 0,
  gap INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'gap', 'incomplete')),
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_recon_day ON support_reconciliations (date, currency);

-- Statements the organisation's finance person enters or imports (bank balance for the day)
CREATE TABLE IF NOT EXISTS support_bank_statements (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  account TEXT NOT NULL CHECK (account IN ('creator_funds')),
  currency TEXT NOT NULL,
  balance INTEGER NOT NULL,
  entered_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_bank_day ON support_bank_statements (account, date, currency);

-- Country rules (§4.3): supporters and creators separately
CREATE TABLE IF NOT EXISTS support_country_rules (
  country TEXT PRIMARY KEY,
  supporters TEXT NOT NULL DEFAULT 'allowed' CHECK (supporters IN ('allowed', 'blocked')),
  creators TEXT NOT NULL DEFAULT 'allowed' CHECK (creators IN ('allowed', 'blocked', 'waitlist', 'external_link_only')),
  reason TEXT NOT NULL CHECK (reason IN ('sanctions', 'rail_unsupported', 'legal_review', 'admin')),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS support_reports (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('channel', 'payment', 'pledge')),
  target_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_support_reports_status ON support_reports (status, created_at);
CREATE INDEX IF NOT EXISTS idx_support_reports_reporter ON support_reports (reporter_user_id);

-- State of the test collector and test rail (QA and the local stack only; empty in production)
CREATE TABLE IF NOT EXISTS support_test_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- Sanctions seed (§4.3, November 2026): countries under a US comprehensive embargo are blocked for
-- supporters and creators. Syria is not seeded (no longer comprehensively sanctioned since
-- 1 July 2025); the embargoed regions inside a country (Crimea, "DNR", "LNR") are refused by the
-- region check, not a country row. The lawyer confirms the list; a super admin changes it on the
-- Countries page (audited).
INSERT OR IGNORE INTO support_country_rules (country, supporters, creators, reason, changed_by, changed_at) VALUES
  ('CU', 'blocked', 'blocked', 'sanctions', 'system', '2026-11-22T00:00:00.000Z'),
  ('IR', 'blocked', 'blocked', 'sanctions', 'system', '2026-11-22T00:00:00.000Z'),
  ('KP', 'blocked', 'blocked', 'sanctions', 'system', '2026-11-22T00:00:00.000Z');
