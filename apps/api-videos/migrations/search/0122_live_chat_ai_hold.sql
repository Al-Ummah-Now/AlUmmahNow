-- How much the AI scan may hold in a live chat for its moderators to look at (wiki E17-D4): the creator's choice
-- per stream, 'basic' unless they say otherwise. Holding is reversible; held messages are purged after 30 days.
ALTER TABLE live_stream_metadata ADD COLUMN ai_hold TEXT NOT NULL DEFAULT 'basic' CHECK (ai_hold IN ('none', 'basic', 'strict'));
