-- The videos admin's own staff list (lib/admin-staff.ts): every account whose
-- token reached admin-api with the Super Admin, Admin or Moderator role, with
-- the role that token carried. Written from the token's own claims (never read
-- from the auth server's RBAC tables), at most once per user per few minutes.
-- A later token without the role, or an account suspended or deleted through
-- an Auth request, makes the row inactive; account erasure deletes it.
-- Pickers (the contact inbox's "Assign to") read active rows only.
CREATE TABLE IF NOT EXISTS admin_staff (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator')),
    -- Display name from the videos profile when the row was written; the email from the token
    name TEXT,
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    -- Why it is inactive: role_removed, suspended, deleted
    inactive_reason TEXT,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- The autocomplete: active staff by role, then name or email
CREATE INDEX IF NOT EXISTS idx_admin_staff_active_role_name ON admin_staff (active, role, name);
CREATE INDEX IF NOT EXISTS idx_admin_staff_active_email ON admin_staff (active, email);
