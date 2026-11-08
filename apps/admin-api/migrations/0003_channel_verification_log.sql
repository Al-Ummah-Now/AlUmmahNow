-- Migration: channel (scholar) verification audit log (Epic 6.1)
-- Created: 2026-11-08
-- Append-only: one row per verify/unverify decision. The channel object in R2
-- holds the current state (isVerified, verifiedAt, verifiedByUserId).
CREATE TABLE IF NOT EXISTS channel_verification_log (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    verified INTEGER NOT NULL,           -- 1 verified, 0 verification removed
    note TEXT,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channel_verification_log_channel
    ON channel_verification_log (channel_id, created_at);
