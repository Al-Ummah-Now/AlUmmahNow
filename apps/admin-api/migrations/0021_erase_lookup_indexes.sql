-- Account erasure (processor erasure/user-traces.ts) looks rows up by user:
--   DELETE FROM error_group_users WHERE user_key = ?
--   UPDATE error_events ... WHERE user_id = ?
-- Neither column was indexed, so every erased account read the whole of both
-- tables (~28k + ~8k rows on QA; 290M rows read on 2026-11-13 alone).
-- Expand-only: new indexes, no table or data change.
CREATE INDEX IF NOT EXISTS idx_error_group_users_user ON error_group_users (user_key);
CREATE INDEX IF NOT EXISTS idx_error_events_user ON error_events (user_id);
