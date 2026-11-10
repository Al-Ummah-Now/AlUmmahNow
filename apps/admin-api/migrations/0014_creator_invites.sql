-- Invited creators (docs/admin/INVITES.md). Expand-only: one new table.
--
-- The videos admin invites someone by email. admin-api mints the user id
-- (usr_ + 32 hex) and invite id (inv_ + 32 hex), so the person is a videos user
-- at once: profile, creator tier and channels are written in api-videos under
-- that id. The auth account (status 'invited') is made through the
-- auth-moderation-requests queue: nothing talks to auth inside an admin's
-- request. First sign-in with that email lands in the same account.
--
-- Revoke is an admin soft delete (deleted_at/by/reason): restorable for 30
-- days, then purged by auth's cleanup; purge_requested_at queues it now.
CREATE TABLE IF NOT EXISTS creator_invites (
    id TEXT PRIMARY KEY,                    -- inv_… (also auth's invite id and idempotency key)
    user_id TEXT NOT NULL UNIQUE,           -- usr_… (the account's id everywhere)
    email TEXT NOT NULL,                    -- lower case, trimmed
    name TEXT,
    locale TEXT NOT NULL DEFAULT 'en',      -- the invite email's first language
    note TEXT,
    role TEXT NOT NULL DEFAULT 'creator',   -- creator | viewer
    tier_id TEXT,                           -- the creator tier (plan) given
    auth_roles TEXT NOT NULL DEFAULT '[]',  -- JSON: extra auth roles by name (auth's allow-list, e.g. ["Scholar"])
    channels TEXT NOT NULL DEFAULT '[]',    -- JSON [{id, name, handle, action: created|transferred, jobId?}]
    expires_in_days INTEGER NOT NULL DEFAULT 14,
    continue_url TEXT,
    delivery_status TEXT NOT NULL,          -- sending | sent | failed (the account's creation in auth)
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    delivery_error TEXT,
    email_sent INTEGER NOT NULL DEFAULT 0,
    status TEXT,                            -- auth's: invited | active | expired | revoked (NULL until sent)
    expires_at TEXT,
    accepted_at TEXT,
    last_sent_at TEXT,
    send_count INTEGER NOT NULL DEFAULT 0,
    pending_op TEXT,                        -- JSON {op, args}: resend | link | revoke | restore | purge waiting in the queue
    op_error TEXT,                          -- last change that failed after its retries
    sync_requested_at TEXT,
    synced_at TEXT,
    created_by TEXT NOT NULL,
    created_by_email TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_by TEXT,
    deleted_reason TEXT,
    purge_requested_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_creator_invites_email ON creator_invites(email);
CREATE INDEX IF NOT EXISTS idx_creator_invites_created ON creator_invites(created_at);
CREATE INDEX IF NOT EXISTS idx_creator_invites_status ON creator_invites(status, created_at);
