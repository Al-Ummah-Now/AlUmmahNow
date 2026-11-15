-- Multiple audio tracks (wiki AUN-MULTI-AUDIO MA9): extra audio tracks a creator may add to one
-- video, per creator tier. 0 = none (the default Creator tier); ignored by unlimited tiers.
ALTER TABLE creator_tiers ADD COLUMN audio_tracks_per_video INTEGER NOT NULL DEFAULT 0;
