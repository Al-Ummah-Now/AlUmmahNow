-- Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5): an owner offers the channel to one of its
-- channel admins, who accepts. The move itself is the admin move job (channel.transfer).
-- Expand-only: a new table and its indexes.
CREATE TABLE IF NOT EXISTS channel_move_offers (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  -- offered | moved | declined | cancelled | expired | stopped | refused
  status TEXT NOT NULL,
  job_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  updated_at TEXT NOT NULL
);
-- One open offer per channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_move_offers_open ON channel_move_offers (channel_id) WHERE status = 'offered';
-- Offers to me, offers I made
CREATE INDEX IF NOT EXISTS idx_channel_move_offers_to ON channel_move_offers (to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_move_offers_from ON channel_move_offers (from_user_id, status);
-- The 30-day limit: the channel's last completed move
CREATE INDEX IF NOT EXISTS idx_channel_move_offers_channel ON channel_move_offers (channel_id, status, responded_at);
