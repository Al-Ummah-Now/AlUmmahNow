-- Studio limits (docs/specs/CREATOR-STUDIO.md §8.3). Open on every plan at launch; admins can change them per plan.
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'studio.drafts.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'studio.bulkSchedule', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'studio.drafts.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'studio.bulkSchedule', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'studio.drafts.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'studio.bulkSchedule', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'studio.drafts.max', '"unlimited"');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'studio.bulkSchedule', 'true');
