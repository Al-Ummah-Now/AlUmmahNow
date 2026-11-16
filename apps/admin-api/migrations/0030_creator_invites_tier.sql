-- Pending invites per creator tier (owner rule 2026-11-15: a tier that users
-- or pending invites carry cannot be deleted; lib/invites.ts
-- pendingInvitesForTier / pendingInvitesByTier). Expand-only: one index, so
-- the counts never scan the invites table.
CREATE INDEX IF NOT EXISTS idx_creator_invites_tier ON creator_invites (tier_id, status);
