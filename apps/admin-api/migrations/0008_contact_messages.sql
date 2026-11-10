-- Contact us (videos site /[locale]/contact) and the admin inbox (admin-web /contact).
-- Expand-only: two new tables, nothing existing changes.

-- One row per message sent from the contact form.
CREATE TABLE IF NOT EXISTS contact_messages (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'replied', 'closed', 'spam')),
    topic TEXT NOT NULL CHECK (topic IN ('general', 'account', 'problem', 'content', 'partnership')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    -- Set when the sender was signed in; the email is then the account's email
    user_id TEXT,
    locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
    page_url TEXT,
    user_agent TEXT,
    -- SHA-256 of the sender's IP (rate limit); the IP itself is never stored
    ip_hash TEXT NOT NULL,
    assignee_id TEXT,
    assignee_email TEXT,
    -- Delivery of the support-inbox notification and the sender's acknowledgement:
    -- sent, failed, skipped (not configured) or sunk (E2E address outside production)
    notify_status TEXT,
    ack_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_ip ON contact_messages (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user ON contact_messages (user_id, created_at);

-- Staff thread on a message: internal notes and replies emailed to the sender.
CREATE TABLE IF NOT EXISTS contact_notes (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'reply')),
    body TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_email TEXT,
    -- Replies only: where the email went and how delivery went (sent, failed, sunk)
    email_to TEXT,
    email_subject TEXT,
    email_status TEXT,
    email_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_notes_message ON contact_notes (message_id, created_at);
