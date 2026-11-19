-- Where an audited admin action came from (shared-types request-origin.ts): JSON of the acting
-- request's surface (admin web, the native Admin app on iOS/Android/desktop, api), app version,
-- device class and country. No IP, User-Agent or URL. Null for rows written outside a request and
-- for every row written before this migration. Expand-only.
ALTER TABLE site_settings_log ADD COLUMN origin TEXT;
ALTER TABLE admin_audit_log ADD COLUMN origin TEXT;
