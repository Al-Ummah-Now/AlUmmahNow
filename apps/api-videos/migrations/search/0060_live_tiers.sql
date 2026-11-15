-- Live streaming in creator tiers (packages/shared-types/src/creator-tiers.ts,
-- lib/live/tier-gate.ts). Expand-only.
--
-- A tier says whether its holder may go live and within which limits: hours a
-- calendar month (UTC), streams at once, longest stream. The tier that applies
-- is the channel OWNER's, like uploads. Creator and Unlimited ship with live
-- on; every other tier (and users with no tier) has it off until an admin
-- turns it on in the videos admin (Tiers).

ALTER TABLE creator_tiers ADD COLUMN live INTEGER NOT NULL DEFAULT 0;
ALTER TABLE creator_tiers ADD COLUMN live_hours_month INTEGER NOT NULL DEFAULT 20;
ALTER TABLE creator_tiers ADD COLUMN live_max_concurrent INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creator_tiers ADD COLUMN live_max_stream_minutes INTEGER NOT NULL DEFAULT 240;

UPDATE creator_tiers SET live = 1 WHERE id IN ('creator', 'unlimited');

-- The tier holder a session counts against (the channel owner when it was
-- provisioned): this month's hours and streams at once are summed per holder.
-- NULL on sessions from before this migration (they count against nobody).
ALTER TABLE live_sessions ADD COLUMN owner_id TEXT;
-- Longest this session may stay live, in minutes, from the holder's tier when
-- it was provisioned or started: the tier's longest stream, or what is left of
-- the month's hours if less. NULL = no limit (Unlimited, super admin). The
-- live sweep ends a session past it (end_reason 'tier_limit').
ALTER TABLE live_sessions ADD COLUMN limit_minutes INTEGER;
CREATE INDEX IF NOT EXISTS idx_live_sessions_owner ON live_sessions (owner_id, created_at);
