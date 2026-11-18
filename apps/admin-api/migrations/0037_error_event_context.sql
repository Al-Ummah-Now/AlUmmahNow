-- Error detail context (videos admin Errors page): per sample, what an admin needs to act
-- without Cloudflare access. JSON of ErrorContext (@al-ummah/shared-types error-reporting/context.ts):
-- worker script, video/channel ids, the upstream call that failed (service + status + templated
-- route), a short breadcrumb trail and the queue job (queue, message id, attempt). Ids only, scrubbed.
-- Expand-only: one nullable column; older events have none.
ALTER TABLE error_events ADD COLUMN context_json TEXT;
