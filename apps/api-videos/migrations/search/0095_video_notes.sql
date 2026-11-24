-- E21.8a: private video notes (wiki Epic 21, owner decision E21-D9).
-- Exact-time bookmarks with an optional end time; last write wins per note; a delete is a
-- tombstone (body cleared) so other devices sync it. Erased with the account.
CREATE TABLE IF NOT EXISTS video_notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- A video's notes in time order, and the per-user bounded count
CREATE INDEX IF NOT EXISTS idx_video_notes_user_video ON video_notes (user_id, video_id, start_ms, id);
-- Sync and Library: the user's notes by last change
CREATE INDEX IF NOT EXISTS idx_video_notes_user_updated ON video_notes (user_id, updated_at, id);

-- Per-tier note limit (admin-managed); NULL = no limit
ALTER TABLE creator_tiers ADD COLUMN notes_max INTEGER DEFAULT 1000;
UPDATE creator_tiers SET notes_max = NULL WHERE id = 'unlimited';
