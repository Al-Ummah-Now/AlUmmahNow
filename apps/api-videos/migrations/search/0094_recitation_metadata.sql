-- E21.4a: human-supplied reciter metadata editing, admin-managed per creator tier.
-- The feature switch stays off by default; this capability has no effect until E21 is enabled.
ALTER TABLE creator_tiers ADD COLUMN recitation_metadata INTEGER NOT NULL DEFAULT 1;
