-- AI category suggestions ("AI suggests, uploader confirms").
--
-- One row per subject: a video (subject_id = video id) or an upload-form draft
-- before its video exists (subject_id = 'draft:<userId>:<key>'). Written by
-- api-videos (request, outcome), the processor (the queued AI job) and
-- admin-api (review, retry, backfill); all three bind this database.
-- Enumerated values are validated in code (packages/shared-types/src/category-suggestion.ts),
-- not with CHECK constraints, so new values never need a table rebuild.
-- No content copies: the job reads the video's text from R2 when it runs
-- (drafts carry their text in the queue message only).
CREATE TABLE IF NOT EXISTS category_suggestions (
  subject_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,            -- 'video' | 'draft'
  user_id TEXT,
  channel_id TEXT,
  reason TEXT NOT NULL,                  -- 'draft' | 'upload' | 'edit' | 'backfill' | 'retry'
  status TEXT NOT NULL,                  -- 'pending' | 'done' | 'failed' | 'budget' | 'disabled' | 'empty'
  input_hash TEXT,                       -- SHA-256 of prompt version + text: same text, no new model call
  category TEXT,                         -- the model's top category
  confidence REAL,                       -- its confidence, 0..1
  options_json TEXT,                     -- up to 3 [{category, confidence}], best first
  model TEXT,
  prompt_version TEXT,
  threshold REAL,                        -- preselect threshold in force when the job ran
  applied INTEGER NOT NULL DEFAULT 0,    -- 1 = written onto the video as its category (source 'ai')
  previous_category TEXT,                -- backup: the video's category before the AI wrote it
  previous_source TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'changed' | 'none'
  final_category TEXT,                   -- what the uploader or an admin kept
  reviewed_by TEXT,                      -- user id of that person
  reviewed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,   -- failed attempts of the current request
  last_error TEXT,
  created_at INTEGER NOT NULL,           -- epoch ms
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catsug_status ON category_suggestions (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_catsug_review ON category_suggestions (subject_type, outcome, confidence);
CREATE INDEX IF NOT EXISTS idx_catsug_hash ON category_suggestions (input_hash);
CREATE INDEX IF NOT EXISTS idx_catsug_user ON category_suggestions (user_id, created_at);
