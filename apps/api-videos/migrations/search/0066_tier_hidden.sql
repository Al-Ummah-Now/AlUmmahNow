-- Hidden tiers (owner, 2026-11-19; wiki AUN-TIER-REQUESTS O37 follow-up): a hidden tier never shows on
-- /upgrade or any tier list a user sees, except as the current tier of the people on it. Admins still
-- list, invite to and grant it. The default tier is never hidden (enforced in lib/creatorTiers.ts).
ALTER TABLE creator_tiers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
