-- Admin queues (docs/admin/QUEUES.md): an "Action needed" and a "History" tab
-- on AI moderation flags, contact messages and errors. History shows who
-- handled an item, what they did and when, so each queue records it on the
-- row (filterable and indexed) instead of reading it back from the audit logs.
-- Expand-only: nullable columns, a backfill of items already handled, indexes.

-- AI moderation: the last reviewer decision on a signal (agree, disagree, hide, restore)
ALTER TABLE moderation_signals ADD COLUMN handled_action TEXT;
ALTER TABLE moderation_signals ADD COLUMN handled_by_id TEXT;
ALTER TABLE moderation_signals ADD COLUMN handled_by_email TEXT;
ALTER TABLE moderation_signals ADD COLUMN handled_at TEXT;

UPDATE moderation_signals SET
  handled_action = (SELECT a.action FROM moderation_actions a WHERE a.signal_id = moderation_signals.id AND a.actor_type = 'user'
                    AND a.action IN ('agree', 'disagree', 'hide', 'restore') ORDER BY a.created_at DESC LIMIT 1),
  handled_by_id = (SELECT a.actor_id FROM moderation_actions a WHERE a.signal_id = moderation_signals.id AND a.actor_type = 'user'
                   AND a.action IN ('agree', 'disagree', 'hide', 'restore') ORDER BY a.created_at DESC LIMIT 1),
  handled_at = (SELECT a.created_at FROM moderation_actions a WHERE a.signal_id = moderation_signals.id AND a.actor_type = 'user'
                AND a.action IN ('agree', 'disagree', 'hide', 'restore') ORDER BY a.created_at DESC LIMIT 1)
WHERE EXISTS (SELECT 1 FROM moderation_actions a WHERE a.signal_id = moderation_signals.id AND a.actor_type = 'user'
              AND a.action IN ('agree', 'disagree', 'hide', 'restore'));

-- A review without its audit row still counts as handled
UPDATE moderation_signals SET handled_action = reviewer_decision, handled_by_id = reviewer_id, handled_at = reviewed_at
WHERE handled_at IS NULL AND reviewed_at IS NOT NULL AND reviewer_decision IN ('agree', 'disagree');

CREATE INDEX IF NOT EXISTS idx_modsig_queue_action ON moderation_signals (created_at) WHERE review_status = 'pending' AND handled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_modsig_handled ON moderation_signals (handled_at DESC) WHERE handled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_modsig_handled_by ON moderation_signals (handled_by_id, handled_at DESC) WHERE handled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_modsig_channel ON moderation_signals (channel_id);

-- Contact messages: who moved the message to replied, closed or spam, and when
ALTER TABLE contact_messages ADD COLUMN handled_by_id TEXT;
ALTER TABLE contact_messages ADD COLUMN handled_by_email TEXT;
ALTER TABLE contact_messages ADD COLUMN handled_at TEXT;

-- Replied: the latest reply's author
UPDATE contact_messages SET
  handled_by_id = (SELECT n.author_id FROM contact_notes n WHERE n.message_id = contact_messages.id AND n.kind = 'reply' ORDER BY n.created_at DESC LIMIT 1),
  handled_by_email = (SELECT n.author_email FROM contact_notes n WHERE n.message_id = contact_messages.id AND n.kind = 'reply' ORDER BY n.created_at DESC LIMIT 1),
  handled_at = COALESCE((SELECT n.created_at FROM contact_notes n WHERE n.message_id = contact_messages.id AND n.kind = 'reply' ORDER BY n.created_at DESC LIMIT 1), updated_at)
WHERE status = 'replied';
-- Closed and spam: who did it was not recorded before this migration
UPDATE contact_messages SET handled_at = updated_at WHERE status IN ('closed', 'spam') AND handled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_messages_handled ON contact_messages (handled_at DESC) WHERE handled_at IS NOT NULL;

-- Error groups: who resolved or ignored the group, and when
ALTER TABLE error_groups ADD COLUMN handled_by_id TEXT;
ALTER TABLE error_groups ADD COLUMN handled_by_email TEXT;
ALTER TABLE error_groups ADD COLUMN handled_at TEXT;

UPDATE error_groups SET
  handled_by_id = (SELECT a.actor_id FROM error_group_activity a WHERE a.group_id = error_groups.id AND a.kind = 'status' AND a.to_status = error_groups.status ORDER BY a.created_at DESC LIMIT 1),
  handled_by_email = (SELECT a.actor_email FROM error_group_activity a WHERE a.group_id = error_groups.id AND a.kind = 'status' AND a.to_status = error_groups.status ORDER BY a.created_at DESC LIMIT 1),
  handled_at = COALESCE((SELECT a.created_at FROM error_group_activity a WHERE a.group_id = error_groups.id AND a.kind = 'status' AND a.to_status = error_groups.status ORDER BY a.created_at DESC LIMIT 1), resolved_at, updated_at)
WHERE status IN ('resolved', 'ignored');

CREATE INDEX IF NOT EXISTS idx_error_groups_handled ON error_groups (handled_at DESC) WHERE handled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_groups_first_seen ON error_groups (first_seen);
