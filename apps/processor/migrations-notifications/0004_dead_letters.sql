-- Dead-letter store (queue DLQ visibility). The processor consumes each
-- environment's DLQ (al-ummah-now-dlq[-stage|-qa]) and keeps every message it
-- receives here, so failures are queryable and can be replayed through
-- POST /dlq/replay instead of silently expiring in the queue.
-- Lives in the processor-owned notifications database, which already has a
-- migration pipeline in QA, stage and production. Rows expire after 30 days.
CREATE TABLE IF NOT EXISTS dead_letters (
  -- Queue message id of the DLQ delivery (unique per dead-lettered message)
  id TEXT PRIMARY KEY,
  -- AlUmmahMessage.id from the body, when present
  message_id TEXT,
  -- Numeric MessageType and its name ('unknown' when the body has none)
  message_type INTEGER,
  type_name TEXT NOT NULL,
  -- Queue the message came from: 'videos' or 'moderation' (from the type)
  source TEXT NOT NULL,
  -- DLQ the processor consumed it from
  dlq TEXT NOT NULL,
  -- Delivery attempts on the DLQ itself
  attempts INTEGER NOT NULL DEFAULT 1,
  failure_reason TEXT,
  -- Original body as JSON (truncated to 64 KiB; truncated rows cannot be replayed)
  body_json TEXT NOT NULL,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  replayed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_received ON dead_letters(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letters_type ON dead_letters(type_name, received_at DESC);
