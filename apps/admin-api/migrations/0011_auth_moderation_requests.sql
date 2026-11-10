-- Moderation requests sent to auth (docs/admin/AUTH_MODERATION_REQUESTS.md).
--
-- Auth and videos are separate apps: videos admins ban/delete videos users here,
-- and only ASK auth to act on the auth identity (suspend, delete, sign out
-- everywhere, force a password reset). Auth admins decide in the auth admin.
-- Sending and status polling run from the auth-moderation-requests queue with
-- retries; a request that cannot be delivered is flagged (delivery_status 'failed')
-- for a videos admin to retry. admin_audit_log is the videos admin's audit log.
-- Expand-only.

CREATE TABLE IF NOT EXISTS auth_moderation_requests (
    id TEXT PRIMARY KEY,                    -- ours: areq_…
    auth_request_id TEXT UNIQUE,            -- auth's modreq_…, once delivered
    subject_user_id TEXT NOT NULL,          -- auth user id (usr_…)
    action TEXT NOT NULL,                   -- suspend_account | delete_account | revoke_sessions | require_password_reset | other
    reason_category TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '[]',    -- JSON [{url,label}]
    requested_by_id TEXT NOT NULL,          -- videos admin who sent it
    requested_by_name TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,   -- sent to auth as Idempotency-Key on every attempt
    delivery_status TEXT NOT NULL,          -- sending | sent | failed
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    delivery_error TEXT,
    status TEXT,                            -- auth's: pending | info_requested | approved | rejected | actioned (NULL until sent)
    decision_note TEXT,
    history TEXT NOT NULL DEFAULT '[]',     -- auth's history (JSON), as last read
    pending_info TEXT,                      -- an answer to auth's "more info" waiting in the queue (JSON {note, evidence, requested_by})
    sync_error TEXT,                        -- last status read or answer that failed after its retries
    sync_requested_at TEXT,                 -- last time a status read was queued
    synced_at TEXT,                         -- last successful status read
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_modreq_subject ON auth_moderation_requests(subject_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_modreq_delivery ON auth_moderation_requests(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_modreq_status ON auth_moderation_requests(status, created_at);

-- The videos admin audit log: who did what to which target, from the admin API.
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    action TEXT NOT NULL,                   -- e.g. auth_request.created
    target_type TEXT NOT NULL,              -- e.g. user
    target_id TEXT NOT NULL,
    metadata TEXT,                          -- JSON
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
