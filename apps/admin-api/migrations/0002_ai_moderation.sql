-- Migration: AI-assisted moderation (Epic 28, docs/specs/EPIC-28-PLAN.md §2)
-- Created: 2026-11-08
-- Enumerated values (surface, decision, review_status, action) are validated in code,
-- not with CHECK constraints, so new values never need a table rebuild.

-- One row per scan of a subject. No content copies: subjects are referenced by type + id.
-- `translation` (reviewer aid for Arabic) is the one exception and is cleared after 30 days.
CREATE TABLE IF NOT EXISTS moderation_signals (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,          -- 'comment' | 'post' | 'post_comment' | 'video'
    subject_id TEXT NOT NULL,
    parent_id TEXT,                      -- video id for comments, post id for post comments
    surface TEXT NOT NULL,               -- 'video_comment' | 'community_post' | 'post_comment' | 'video_metadata'
    author_id TEXT,
    channel_id TEXT,
    language TEXT,                       -- 'ar' | 'en' | 'other'
    categories_json TEXT NOT NULL DEFAULT '{}', -- {category: score 0..1}
    top_category TEXT,
    top_score REAL,
    models TEXT,                         -- comma-separated model ids used
    prompt_version TEXT,
    decision TEXT NOT NULL,              -- 'none' | 'would_flag' | 'would_hide' | 'flag' | 'hide' | 'skipped'
    skip_reason TEXT,                    -- 'disabled' | 'budget' | 'error' | 'empty'
    priority INTEGER NOT NULL DEFAULT 0,
    review_status TEXT NOT NULL DEFAULT 'n/a', -- 'pending' | 'agreed' | 'disagreed' | 'n/a'
    reviewer_id TEXT,
    reviewer_decision TEXT,
    reviewed_at TEXT,
    translation TEXT,
    translation_expires_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_modsig_review ON moderation_signals(review_status, priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_modsig_subject ON moderation_signals(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_modsig_decision ON moderation_signals(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_modsig_author ON moderation_signals(author_id);
CREATE INDEX IF NOT EXISTS idx_modsig_created ON moderation_signals(created_at);

-- Audit log: every action on a subject, by the AI or a person.
CREATE TABLE IF NOT EXISTS moderation_actions (
    id TEXT PRIMARY KEY,
    signal_id TEXT,
    subject_type TEXT,
    subject_id TEXT,
    action TEXT NOT NULL,                -- 'flag' | 'hide' | 'restore' | 'agree' | 'disagree' | 'config_change' | 'appeal_open' | 'appeal_upheld' | 'appeal_overturned' | 'shadow'
    actor_type TEXT NOT NULL,            -- 'ai' | 'user'
    actor_id TEXT,                       -- reviewer id, or null for the AI
    model TEXT,
    prompt_version TEXT,
    category TEXT,
    score REAL,
    reason TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_modact_signal ON moderation_actions(signal_id);
CREATE INDEX IF NOT EXISTS idx_modact_subject ON moderation_actions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_modact_created ON moderation_actions(created_at DESC);

-- Remote config (kill switch, daily cap, per-category policy). Values are JSON.
CREATE TABLE IF NOT EXISTS moderation_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
);

-- Workers AI usage per UTC day × model: the budget cap and the cost dashboard read it.
CREATE TABLE IF NOT EXISTS ai_usage_daily (
    day TEXT NOT NULL,                   -- 'YYYY-MM-DD' (UTC)
    model TEXT NOT NULL,
    feature TEXT NOT NULL DEFAULT 'moderation',
    calls INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    neurons REAL NOT NULL DEFAULT 0,
    usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model, feature)
);

-- Appeals against AI-originated actions (UI in story 28.11).
CREATE TABLE IF NOT EXISTS moderation_appeals (
    id TEXT PRIMARY KEY,
    action_id TEXT,
    signal_id TEXT,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'upheld' | 'overturned'
    reviewer_id TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_modappeal_status ON moderation_appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_modappeal_user ON moderation_appeals(user_id);
