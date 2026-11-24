-- A reported live chat message (wiki E17 §5.2): one more entity_type. SQLite cannot change a CHECK
-- constraint, so the table is rebuilt with the same rows and indexes (as 0020 did). Nothing references reports.

CREATE TABLE reports_new (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('video', 'comment', 'channel', 'livestream', 'playlist', 'post', 'live_chat')),
    entity_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other')),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
    moderator_id TEXT,
    action TEXT CHECK (action IN ('warning', 'removed', 'banned', 'deleted', 'dismissed')),
    moderator_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    resolved_at TEXT,
    entity_title TEXT,
    entity_parent_id TEXT,
    channel_id TEXT,
    channel_name TEXT,
    owner_id TEXT,
    owner_name TEXT,
    reporter_name TEXT,
    moderator_name TEXT,
    meta_synced_at TEXT,
    banned_user_id TEXT
);

INSERT INTO reports_new (id, entity_type, entity_id, reporter_id, reason, description, status, moderator_id, action, moderator_notes, created_at, updated_at, resolved_at, entity_title, entity_parent_id, channel_id, channel_name, owner_id, owner_name, reporter_name, moderator_name, meta_synced_at, banned_user_id)
SELECT id, entity_type, entity_id, reporter_id, reason, description, status, moderator_id, action, moderator_notes, created_at, updated_at, resolved_at, entity_title, entity_parent_id, channel_id, channel_name, owner_id, owner_name, reporter_name, moderator_name, meta_synced_at, banned_user_id FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

-- Every index of 0001 and 0020 (dropped with the old table)
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_entity_type ON reports(entity_type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports(entity_type, entity_id);

-- Action needed: open reports grouped per item, oldest first
CREATE INDEX IF NOT EXISTS idx_reports_open_entity ON reports(status, entity_type, entity_id, created_at);
-- History: closed reports by when they were closed, and per moderator
CREATE INDEX IF NOT EXISTS idx_reports_closed ON reports(status, resolved_at);
CREATE INDEX IF NOT EXISTS idx_reports_moderator ON reports(moderator_id, resolved_at);
-- A page's items by id, and the rows still to fill
CREATE INDEX IF NOT EXISTS idx_reports_entity_id ON reports(entity_id);
CREATE INDEX IF NOT EXISTS idx_reports_meta ON reports(meta_synced_at);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(owner_id);
