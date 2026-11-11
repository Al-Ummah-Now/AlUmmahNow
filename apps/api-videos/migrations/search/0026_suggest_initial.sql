-- Pickers open with content (owner rule 2026-11-11): the empty-query
-- suggestions (lib/search/query.ts initialSuggestionsFromIndex) read a first
-- page on an index, never a scan. Expand-only: four indexes.
-- Featured-channel picker: most viewed visible channels.
CREATE INDEX IF NOT EXISTS idx_search_channels_popular ON search_channels (visible, views, popularity);
-- A channel's newest videos and playlists (section and playlist pickers).
CREATE INDEX IF NOT EXISTS idx_search_videos_channel_created ON search_videos (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_search_playlists_channel_created ON search_playlists (channel_id, created_at);
-- The CMS picker's playlist tab with nothing typed (/api/search?type=playlist&sort=date).
CREATE INDEX IF NOT EXISTS idx_search_playlists_created ON search_playlists (visible, created_at);
