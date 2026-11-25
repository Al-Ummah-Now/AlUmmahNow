-- The child_safety report reason, the alerts those reports raise, and the guest report limits.
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt keeping every row and index
-- (0051 and 0052 did the same).

CREATE TABLE reports_new (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('video', 'comment', 'channel', 'livestream', 'playlist', 'post', 'live_chat')),
    entity_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('child_safety', 'inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other')),
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

-- The indexes of 0001, 0020, 0051 and 0052
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_entity_type ON reports(entity_type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reports_open_entity ON reports(status, entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_closed ON reports(status, resolved_at);
CREATE INDEX IF NOT EXISTS idx_reports_moderator ON reports(moderator_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_reports_entity_id ON reports(entity_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_meta ON reports(meta_synced_at);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(owner_id);
CREATE INDEX IF NOT EXISTS idx_reports_banned_user ON reports(banned_user_id) WHERE banned_user_id IS NOT NULL;

-- The moderation page reads its pages in order from these, never the table (ReportsList.ts)
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_type_created ON reports(entity_type, created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_reason_created ON reports(reason, created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_created ON reports(reporter_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_reports_child_safety_open ON reports(created_at, id) WHERE reason = 'child_safety' AND status IN ('pending', 'reviewing');

-- One row per item with open child_safety reports, written in the same transaction as the report: the
-- Errors page alert (alerted_at) and the kept copy of the item's records (evidence) are done from here
-- and retried until they are (lib/moderation/childSafety.ts). No content and no person: ids only.
CREATE TABLE IF NOT EXISTS child_safety_alerts (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    alerted_at TEXT,
    -- The Errors page item: the item's own, or the hour's shared one above the hourly limit
    flag_key TEXT,
    own_flag INTEGER NOT NULL DEFAULT 0,
    -- kept | none (nothing to keep); NULL until done
    evidence TEXT,
    evidence_attempts INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    PRIMARY KEY (entity_type, entity_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_child_safety_alerts_pending ON child_safety_alerts(created_at) WHERE alerted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_child_safety_alerts_evidence ON child_safety_alerts(evidence_attempts, created_at) WHERE evidence IS NULL;
CREATE INDEX IF NOT EXISTS idx_child_safety_alerts_alerted ON child_safety_alerts(alerted_at);
CREATE INDEX IF NOT EXISTS idx_child_safety_alerts_flag ON child_safety_alerts(flag_key);

-- Guest report limits: counters under keys that are keyed hashes of the day and the network prefix (or of
-- the target). Nothing here links to a report, and each row is deleted within two days.
CREATE TABLE IF NOT EXISTS guest_report_limits (
    k TEXT PRIMARY KEY,
    n INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_guest_report_limits_expires ON guest_report_limits(expires_at);

-- Reports sent without an account are deleted a year after their decision (lib/moderation/retention.ts)
CREATE INDEX IF NOT EXISTS idx_reports_guest_closed ON reports(resolved_at) WHERE reporter_id = 'guest' AND status IN ('resolved', 'dismissed');
CREATE INDEX IF NOT EXISTS idx_child_safety_alerts_closed ON child_safety_alerts(closed_at) WHERE closed_at IS NOT NULL;

-- The item a case is about, as reports name it: what is under a takedown is shown to super admins only, and its
-- kept records stay while a case is open
ALTER TABLE csam_cases ADD COLUMN item_type TEXT;
ALTER TABLE csam_cases ADD COLUMN item_id TEXT;
UPDATE csam_cases SET
    item_type = CASE item_kind WHEN 'video' THEN 'video' WHEN 'video_thumbnail' THEN 'video' WHEN 'post_image' THEN 'post' WHEN 'comment' THEN 'comment' WHEN 'live_stream' THEN 'livestream' WHEN 'channel_image' THEN 'channel' END,
    item_id = CASE item_kind WHEN 'video' THEN json_extract(resolution, '$.videoId') WHEN 'video_thumbnail' THEN json_extract(resolution, '$.videoId') WHEN 'post_image' THEN json_extract(resolution, '$.postId') WHEN 'comment' THEN json_extract(resolution, '$.commentId') WHEN 'live_stream' THEN json_extract(resolution, '$.streamId') WHEN 'channel_image' THEN json_extract(resolution, '$.channelId') END
WHERE resolution IS NOT NULL AND json_valid(resolution);
CREATE INDEX IF NOT EXISTS idx_csam_cases_item ON csam_cases(item_type, item_id) WHERE item_id IS NOT NULL;
