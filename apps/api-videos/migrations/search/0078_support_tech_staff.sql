-- Creator support (wiki AUN-MEMBERS §9.6): accounts marked as tech staff. The owner is a tech employee of
-- the organization with no access to its money; a tech-staff account can never be on the finance list,
-- so it never holds a money permission (refunds, disputes, payouts, ledger, providers).
-- Marking takes one super admin; unmarking needs a different super admin from the one who marked it.
CREATE TABLE IF NOT EXISTS support_tech_staff (
  user_id TEXT PRIMARY KEY,
  marked_by TEXT NOT NULL,
  marked_at TEXT NOT NULL
) WITHOUT ROWID;

-- Who proposed a finance-list change and who approved it are different people (two-person change);
-- the removal is recorded with who removed it.
ALTER TABLE support_finance_members ADD COLUMN removed_by TEXT;
