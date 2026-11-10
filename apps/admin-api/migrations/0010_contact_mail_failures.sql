-- Contact us mail goes through a queue (al-ummah-now-contact-mail[-env]) with
-- retries. A delivery that finally fails flags its message for an admin.
-- Expand-only: new nullable columns and an index.

-- Set while any delivery of the message (notification, acknowledgement or a
-- reply) has finally failed; cleared when no failed delivery is left.
ALTER TABLE contact_messages ADD COLUMN send_failed_at TEXT;
-- The last final failure, for the admin (provider status and text, never secrets)
ALTER TABLE contact_messages ADD COLUMN delivery_error TEXT;
-- A reply's delivery error
ALTER TABLE contact_notes ADD COLUMN email_error TEXT;

CREATE INDEX IF NOT EXISTS idx_contact_messages_send_failed ON contact_messages (send_failed_at) WHERE send_failed_at IS NOT NULL;
