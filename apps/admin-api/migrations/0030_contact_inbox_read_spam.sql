-- Contact inbox (admin-web /contact): read/unread, "in progress", and the spam verdict.
--
-- 1. Read and status are separate now: read_at (NULL = unread) replaces the
--    'new' status, which becomes 'open' + unread. A status 'in_progress' is
--    added. SQLite cannot change a CHECK constraint, so both contact tables
--    are rebuilt with the same rows.
-- 2. bot_verdict: the Turnstile outcome at submission (pass, fail, missing,
--    error, off, bypass; NULL for messages from before this migration).
-- 3. spam_reason: why the message is spam (turnstile, content, admin).
--
-- Safety: contact_notes references contact_messages ON DELETE CASCADE. The new
-- notes table references the new messages table, and the OLD notes table is
-- dropped before the OLD messages table, so dropping a parent never cascades
-- into rows that are kept. Renaming contact_messages_new updates the new notes
-- table's reference to the final name.
PRAGMA defer_foreign_keys = true;

CREATE TABLE contact_messages_new (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'replied', 'closed', 'spam')),
    topic TEXT NOT NULL CHECK (topic IN ('general', 'account', 'problem', 'content', 'partnership')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    user_id TEXT,
    locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    page_url TEXT,
    user_agent TEXT,
    ip_hash TEXT NOT NULL,
    assignee_id TEXT,
    assignee_email TEXT,
    notify_status TEXT,
    ack_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    send_failed_at TEXT,
    delivery_error TEXT,
    deleted_at TEXT,
    deleted_by TEXT,
    delete_reason TEXT,
    purge_requested_at TEXT,
    purge_requested_by TEXT,
    handled_by_id TEXT,
    handled_by_email TEXT,
    handled_at TEXT,
    read_at TEXT,
    bot_verdict TEXT,
    spam_reason TEXT
);

INSERT INTO contact_messages_new (id, status, topic, name, email, message, user_id, locale, page_url, user_agent, ip_hash, assignee_id, assignee_email,
    notify_status, ack_status, created_at, updated_at, send_failed_at, delivery_error, deleted_at, deleted_by, delete_reason, purge_requested_at,
    purge_requested_by, handled_by_id, handled_by_email, handled_at, read_at, bot_verdict, spam_reason)
SELECT id, CASE WHEN status = 'new' THEN 'open' ELSE status END, topic, name, email, message, user_id, locale, page_url, user_agent, ip_hash,
    assignee_id, assignee_email, notify_status, ack_status, created_at, updated_at, send_failed_at, delivery_error, deleted_at, deleted_by,
    delete_reason, purge_requested_at, purge_requested_by, handled_by_id, handled_by_email, handled_at,
    CASE WHEN status = 'new' THEN NULL ELSE updated_at END, NULL, CASE WHEN status = 'spam' THEN 'admin' ELSE NULL END
FROM contact_messages;

CREATE TABLE contact_notes_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES contact_messages_new(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'reply')),
    body TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_email TEXT,
    email_to TEXT,
    email_subject TEXT,
    email_status TEXT,
    email_id TEXT,
    created_at TEXT NOT NULL,
    email_error TEXT
);

INSERT INTO contact_notes_new (id, message_id, kind, body, author_id, author_email, email_to, email_subject, email_status, email_id, created_at, email_error)
SELECT id, message_id, kind, body, author_id, author_email, email_to, email_subject, email_status, email_id, created_at, email_error
FROM contact_notes;

-- Children first: the old messages table then has nothing referencing it
DROP TABLE contact_notes;
DROP TABLE contact_messages;
ALTER TABLE contact_messages_new RENAME TO contact_messages;
ALTER TABLE contact_notes_new RENAME TO contact_notes;

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_ip ON contact_messages (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user ON contact_messages (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_send_failed ON contact_messages (send_failed_at) WHERE send_failed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_messages_deleted ON contact_messages (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_messages_handled ON contact_messages (handled_at DESC) WHERE handled_at IS NOT NULL;
-- The nav badge and the Unread view: unread live messages that are not spam
CREATE INDEX IF NOT EXISTS idx_contact_messages_unread ON contact_messages (created_at DESC) WHERE read_at IS NULL AND deleted_at IS NULL AND status <> 'spam';
CREATE INDEX IF NOT EXISTS idx_contact_notes_message ON contact_notes (message_id, created_at);

-- Who can be assigned a message: the videos admins with contact:manage, recorded
-- when they use the inbox (the videos admin keeps its own roster; roles are not
-- read from the auth server). last_seen_at is refreshed at most once a day.
CREATE TABLE IF NOT EXISTS contact_staff (
    user_id TEXT PRIMARY KEY,
    email TEXT,
    last_seen_at TEXT NOT NULL
);
