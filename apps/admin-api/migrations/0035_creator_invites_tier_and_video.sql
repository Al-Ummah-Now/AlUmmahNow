-- Invites give a tier, not a creator/viewer role (owner 2026-11-16: every account has a
-- stored tier and the tier decides what it may do; lib/invites.ts no longer reads or
-- writes creator_invites.role). Data only, expand-safe: the column stays (an old
-- worker still writing it during a deploy keeps working) and is never read again.
-- Viewer invites gave no creator access, so they map to the default tier: tier_id
-- NULL, which the list shows as the current default tier. Creator invites keep their
-- tier (NULL, from before tiers were picked, is the default tier as well).
UPDATE creator_invites SET tier_id = NULL WHERE role = 'viewer' AND tier_id IS NOT NULL;

-- A video from the videos site per email language (owner 2026-11-16: "one for Arabic,
-- the other for English"): ids only; title, channel and picture are read at every send.
-- An email uses its own language's video and never the other's; one that is missing or
-- no longer public leaves the card out. Expand-only. The default video per language lives with the
-- creator invite email settings (lib/email-templates.ts), prefilled into the invite form.
ALTER TABLE creator_invites ADD COLUMN video_en_id TEXT;
ALTER TABLE creator_invites ADD COLUMN video_ar_id TEXT;
