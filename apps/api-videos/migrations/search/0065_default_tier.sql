-- The default creator tier and Free (wiki AUN-TIER-REQUESTS "Default tier";
-- owner decisions 2026-11-15). Expand-only.
--
-- 1. One minimum tier, **Free** («مجاني»): the Member tier (0051) is renamed,
--    keeping its id `member` so every assignment carries over. It is shipped,
--    never deletable, not requestable (nobody requests the bottom tier) and
--    holds exactly what a user with no tier can do today: no uploads, no
--    channel creation, no pages, 0 caption minutes. Nothing changes for anyone
--    on deploy. Its limits are fully editable in the admin.
-- 2. creator_tier_settings.default_tier_id: what NEW sign-ups get, written to
--    their account at sign-up (lib/creatorTiers.ts writeSignupTier). Changing
--    it never touches existing accounts. Free out of the box.
-- Accounts without a stored tier get Free from the backfill after the release
-- (scripts/data/backfill-free-tier.ts), so nobody is ever tierless.

UPDATE creator_tiers SET name = 'Free', name_ar = 'مجاني', requestable = 0 WHERE id = 'member';
INSERT OR IGNORE INTO creator_tiers
  (id, name, name_ar, description, description_ar, unlimited, uploads, channels, requestable, sort_order, per_hour, per_day, max_concurrent, max_channels, caption_minutes_month)
VALUES ('member', 'Free', 'مجاني', 'Watch, save, comment and subscribe.', 'شاهد واحفظ وعلّق واشترك.', 0, 0, 0, 0, 0, 10, 50, 3, 1, 0);

CREATE TABLE IF NOT EXISTS creator_tier_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
) WITHOUT ROWID;

INSERT OR IGNORE INTO creator_tier_settings (key, value, updated_by, updated_at)
VALUES ('default_tier_id', 'member', 'system:migration', '2026-11-15T00:00:00.000Z');
