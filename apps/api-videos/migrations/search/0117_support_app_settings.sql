-- Creator support in the native apps (wiki AUN-MEMBERS MEM-D15, decided 2026-11-23: an admin setting). Per
-- platform switches, per platform-and-storefront-region modes and cadence, and the admin's attestations (shared-types
-- support-apps.ts). '{}' reads as hidden everywhere.
ALTER TABLE support_config ADD COLUMN app_support TEXT NOT NULL DEFAULT '{}';
