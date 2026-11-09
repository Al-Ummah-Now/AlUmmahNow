-- Retention chart and traffic sources (docs/specs/CREATOR-STUDIO.md §8.3). On for every plan at launch; admins can change them per plan.
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'analytics.retentionCurve', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'analytics.trafficSources', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'analytics.retentionCurve', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'analytics.trafficSources', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'analytics.retentionCurve', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'analytics.trafficSources', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'analytics.retentionCurve', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'analytics.trafficSources', 'true');
