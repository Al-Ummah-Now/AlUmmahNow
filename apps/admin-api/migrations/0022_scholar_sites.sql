-- White-label scholar sites (wiki AUN-SCHOLAR-SITES SS1): an admin-granted add-on on a channel,
-- in two tiers. No new table: the tiers are plans (audience creator, never public), a grant is
-- one entitlement_overrides row per site.* key on the channel (reason 'addon:<tier>'), and every
-- change is a plan_audit_log row (entity_type 'site', entity_id = channel id).

-- Free: no site.
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.enabled', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.customDomains.max', '0');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.platformMark', '"required"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.pages.max', '0');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.navigation.max', '0');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.analytics', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'site.brandedSignIn', 'false');

-- The two add-on tiers (seed values; admins change them per site at grant).
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, description_en, description_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_addon_site', 'addon-white-label', 'White-label', 'العلامة الخاصة',
          'Add-on: a white-label site on <slug>.alummahnow.org', 'إضافة: موقع بعلامة خاصة على <slug>.alummahnow.org',
          'creator', 'active', 0, 0, 10, 1, 'system');
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, description_en, description_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_addon_site_domain', 'addon-white-label-domain', 'White-label + domain', 'العلامة الخاصة + نطاق',
          'Add-on: a white-label site that can also use its own domains', 'إضافة: موقع بعلامة خاصة يمكنه استخدام نطاقاته الخاصة',
          'creator', 'active', 0, 0, 11, 1, 'system');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.customDomains.max', '0');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.platformMark', '"minimal"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.pages.max', '20');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.navigation.max', '8');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.analytics', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site', 1, 'site.brandedSignIn', 'false');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.customDomains.max', '2');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.platformMark', '"none"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.pages.max', '100');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.navigation.max', '12');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.analytics', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_addon_site_domain', 1, 'site.brandedSignIn', 'true');

-- The admin Sites list reads the site.enabled rows; never a scan of every override.
CREATE INDEX IF NOT EXISTS idx_entitlement_overrides_key ON entitlement_overrides(key, subject_type, created_at);
