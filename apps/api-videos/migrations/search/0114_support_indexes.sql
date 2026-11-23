-- Creator support (wiki AUN-MEMBERS): indexes for reads that would otherwise scan (cross-provider review of
-- #1758, #1761, #1773). Expand-only.

-- support.release: gifts not yet given their release date (MEM-D18 recorded after they arrived)
CREATE INDEX IF NOT EXISTS idx_support_payments_unscheduled ON support_payments (created_at) WHERE available_at IS NULL AND released_at IS NULL;
-- The admin overview (gifts in the last day) and the dormant-balances job
CREATE INDEX IF NOT EXISTS idx_support_payments_created ON support_payments (created_at);
-- Account erasure: refunds a person asked for
CREATE INDEX IF NOT EXISTS idx_support_refunds_requester ON support_refunds (requested_by_user) WHERE requested_by_user IS NOT NULL;
-- The daily reconciliation's balance check covers that day's new ledger entries only
CREATE INDEX IF NOT EXISTS idx_support_ledger_created ON support_ledger (created_at);
