-- Migration: Create reports table
-- Created: 2025-11-27

CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('video', 'comment', 'channel', 'livestream', 'playlist', 'post')),
    entity_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other')),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
    moderator_id TEXT,
    action TEXT CHECK (action IN ('warning', 'removed', 'banned', 'dismissed')),
    moderator_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    resolved_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_entity_type ON reports(entity_type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports(entity_type, entity_id);
