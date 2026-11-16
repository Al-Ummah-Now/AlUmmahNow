-- Member tier and tier requests (wiki AUN-TIER-REQUESTS; packages/shared-types
-- creator-tiers.ts and tier-requests.ts). Expand-only.
--
-- 1. Every tier gets the same capability flags. Existing tiers keep what they
--    allowed (uploads and channels on).
-- 2. The shipped Free tier («مجاني», id `member`): what every user without an assignment row holds
--    (lib/creatorTiers.ts resolveCreator). No uploads, no channels, so nothing
--    changes for those users; an admin can turn either on later without code.
--    No row per user is written: a missing row IS Member, so users who sign up
--    later hold it too.
-- 3. tier_requests: a user asks for a requestable tier on /upgrade; the videos
--    admin approves (assigns it, audited in admin-api) or declines.

ALTER TABLE creator_tiers ADD COLUMN uploads INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creator_tiers ADD COLUMN channels INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creator_tiers ADD COLUMN requestable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE creator_tiers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 50;
ALTER TABLE creator_tiers ADD COLUMN name_ar TEXT;
ALTER TABLE creator_tiers ADD COLUMN description TEXT;
ALTER TABLE creator_tiers ADD COLUMN description_ar TEXT;

UPDATE creator_tiers SET requestable = 1, sort_order = 10, name_ar = COALESCE(name_ar, 'صانع محتوى'),
  description = COALESCE(description, 'Upload videos and run your own channels.'), description_ar = COALESCE(description_ar, 'ارفع المرئيات وأدِر قنواتك.') WHERE id = 'creator';
UPDATE creator_tiers SET sort_order = 100, name_ar = COALESCE(name_ar, 'غير محدود'),
  description = COALESCE(description, 'Everything, with no limits.'), description_ar = COALESCE(description_ar, 'كل شيء، بلا حدود.') WHERE id = 'unlimited';

INSERT OR IGNORE INTO creator_tiers
  (id, name, name_ar, description, description_ar, unlimited, uploads, channels, requestable, sort_order, per_hour, per_day, max_concurrent, max_channels, caption_minutes_month)
VALUES ('member', 'Free', 'مجاني', 'Watch, save, comment and subscribe.', 'شاهد واحفظ وعلّق واشترك.', 0, 0, 0, 1, 0, 10, 50, 3, 1, 0);

-- 4. Tier settings (key/value): 'tier_requests_enabled' is the admin's "Allow tier
--    requests" (on: '1'). With no payment provider enabled it decides between the
--    request form and "Upgrades aren't available right now" (shared-types UPGRADE_MODES).
CREATE TABLE IF NOT EXISTS creator_tier_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
) WITHOUT ROWID;
INSERT OR IGNORE INTO creator_tier_settings (key, value, updated_by, updated_at)
VALUES ('tier_requests_enabled', '1', 'system:migration', '2026-11-15T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS tier_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  -- The tier's name when asked (kept if the tier is renamed or deleted)
  tier_name TEXT NOT NULL,
  -- The tier the user held when asking ('member' when unassigned)
  from_tier_id TEXT NOT NULL,
  name TEXT NOT NULL,
  about TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  decline_reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  -- Delivery of the decision (admin-api tier-request job): in-app notice queued, email outcome
  notified_at TEXT,
  email_status TEXT,
  email_error TEXT
) WITHOUT ROWID;
-- One open request per user, enforced by D1 (two parallel submits: one wins)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tier_requests_one_pending ON tier_requests (user_id) WHERE status = 'pending';
-- The user's latest request, and the 30-day request count
CREATE INDEX IF NOT EXISTS idx_tier_requests_user ON tier_requests (user_id, created_at);
-- The admin queue per status, newest first, keyset on (created_at, id)
CREATE INDEX IF NOT EXISTS idx_tier_requests_status ON tier_requests (status, created_at, id);

-- 5. Tier changes (lib/tierChanges.ts): one row per change of a user's tier for
--    any reason (an approved request, an admin's change, a subscription starting
--    or ending). The user is told in the app at once and by email (admin-api
--    tier-change-mail job on the contact mail queue); delivery is stored here.
CREATE TABLE IF NOT EXISTS creator_tier_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('request', 'admin', 'subscription')),
  from_tier_id TEXT,
  to_tier_id TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL,
  notified_at TEXT,
  email_status TEXT,
  email_error TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_creator_tier_changes_user ON creator_tier_changes (user_id, created_at);
