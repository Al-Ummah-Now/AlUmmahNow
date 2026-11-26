-- Account erasure anonymizes blocks the user placed on channels they do not own.
CREATE INDEX idx_channel_blocks_blocked_by ON channel_blocks (blocked_by);
