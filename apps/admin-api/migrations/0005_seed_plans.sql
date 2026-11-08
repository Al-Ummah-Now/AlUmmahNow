-- Epic 27 seed. Free is the default plan, with the limits the owner chose;
-- admins can edit every value without a deploy. Other plans start as drafts.
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_free', 'free', 'Free', 'مجاني', 'everyone', 'active', 1, 1, 0, 1, 'system');
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_plus', 'plus', 'Plus', 'بلس', 'creator', 'draft', 0, 0, 1, 1, 'system');
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_pro', 'pro', 'Pro', 'برو', 'creator', 'draft', 0, 0, 2, 1, 'system');
INSERT OR IGNORE INTO plans (id, slug, name_en, name_ar, audience, status, is_public, is_default, sort_order, version, created_by)
  VALUES ('plan_institution', 'institution', 'Institution', 'مؤسسات', 'organisation', 'draft', 0, 0, 3, 1, 'system');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'channel.max', '1');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'channel.about.links.max', '5');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'channel.handle', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'comments.replies', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'comments.settings', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'comments.heldForReview', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'upload.monthlyUploads', '10');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'upload.maxDurationMinutes', '30');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'upload.monthlyHours', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'storage.gb', '5');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'live.monthlyMinutes', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'analytics.retentionDays', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'studio.bulkImport', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'studio.teamSeats', '1');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'share.shortLinks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.domains.max', '1');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.customColor', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.hideBranding', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.privateVideos', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'embed.analytics.retentionDays', '28');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'sites.max', '1');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.pageThreads', '3');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.monthlyComments', '1000');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.guestPosting', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.theming', '"light_dark"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.moderators.max', '1');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.filters.advanced', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.export', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.webhooks', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'discussions.ssr.snapshot', 'false');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'share.shortLinks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.domains.max', '5');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.customColor', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.hideBranding', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.privateVideos', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'embed.analytics.retentionDays', '90');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'sites.max', '3');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.pageThreads', '50');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.monthlyComments', '10000');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.guestPosting', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.theming', '"colours"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.moderators.max', '3');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.filters.advanced', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.export', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.webhooks', 'false');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'discussions.ssr.snapshot', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'studio.teamSeats', '2');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'share.shortLinks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.domains.max', '25');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.customColor', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.hideBranding', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.privateVideos', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'embed.analytics.retentionDays', '365');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'sites.max', '10');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.pageThreads', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.monthlyComments', '100000');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.guestPosting', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.theming', '"fonts"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.moderators.max', '10');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.filters.advanced', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.export', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.webhooks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'discussions.ssr.snapshot', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'studio.teamSeats', '10');

INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'share.shortLinks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.enabled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.domains.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.customColor', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.hideBranding', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.privateVideos', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'embed.analytics.retentionDays', '730');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'sites.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.pageThreads', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.monthlyComments', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.guestPosting', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.theming', '"full"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.moderators.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.filters.advanced', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.export', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.webhooks', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'discussions.ssr.snapshot', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'studio.teamSeats', '"unlimited"');
