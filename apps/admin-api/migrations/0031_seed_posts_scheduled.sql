-- Scheduled community posts (Story 29.4, docs/specs/CORE-WEB-EXPERIENCE.md §4 `posts.scheduled`).
-- Open on every plan at launch, like the Studio limits (0016); admins can change it per plan.
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_free', 1, 'posts.scheduled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_plus', 1, 'posts.scheduled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_pro', 1, 'posts.scheduled', 'true');
INSERT OR IGNORE INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES ('plan_institution', 1, 'posts.scheduled', 'true');
