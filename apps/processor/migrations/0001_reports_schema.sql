-- Reports table for content moderation
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,        -- 'video', 'channel', 'comment', 'post', 'playlist'
  entity_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,             -- 'spam', 'harassment', 'inappropriate', 'copyright', 'other'
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'reviewing', 'resolved', 'dismissed'

  -- Resolution fields
  moderator_id TEXT,
  action TEXT,                      -- 'warning', 'removed', 'banned', 'dismissed'
  moderator_notes TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_entity ON reports(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports(status, created_at DESC) WHERE status = 'pending';
