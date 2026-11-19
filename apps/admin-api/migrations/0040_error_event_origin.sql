-- Where the failing request came from (shared-types request-origin.ts), as two small, indexed
-- columns for the Errors list's Origin filter and breakdown; the full origin (device, country,
-- app version, referrer host, campaign, entry page) is in context_json. No IP, UA or URL.
-- Expand-only: nullable columns; older events have none.
ALTER TABLE error_events ADD COLUMN origin_surface TEXT;
ALTER TABLE error_events ADD COLUMN origin_source TEXT;
CREATE INDEX IF NOT EXISTS idx_error_events_origin ON error_events (origin_surface, received_at);
