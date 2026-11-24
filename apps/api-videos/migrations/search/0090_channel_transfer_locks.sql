-- Channel moves (wiki AUN-CHANNEL-CLAIM §3.3): one unfinished move per channel, taken atomically.
-- The row is inserted before the move's job and deleted when the job succeeds; a failed move keeps
-- it, so the channel can't go to a third account until the failed move is finished (Retry).
-- Expand-only: a new table and a new index.
CREATE TABLE IF NOT EXISTS channel_transfer_locks (
  channel_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;

-- A channel's live sessions (key rotation on a move or a member leaving), without a scan
CREATE INDEX IF NOT EXISTS idx_live_sessions_channel ON live_sessions (channel_id, status);
