-- Pre-publication review (wiki AUN-VIDEO-REVIEW, AlUmmahNow docs/specs/VIDEO-REVIEW.md §4).
--
-- One row per review of a subject: a video (upload, resubmit, live VOD, metadata edit), a community
-- post with images, or an avatar / banner / profile picture (VR16). The processor writes the row
-- when the automated check runs; admin-api's review queue (web and native) reads and decides it;
-- api-videos holds the subject's live state (videos: the `review` field).
--
-- Expand-only. Media (frames, audio, transcript text in findings) is purged after
-- media_purge_after (VR12: 30 days after the decision or appeal); rows themselves are kept 12
-- months, then aggregated (retention cron, admin-api).

CREATE TABLE IF NOT EXISTS content_reviews (
    id TEXT PRIMARY KEY,                    -- = the subject's review.reviewId
    subject_type TEXT NOT NULL,             -- 'video' | 'post' | 'avatar' | 'banner' | 'profile_picture'
    subject_id TEXT NOT NULL,
    channel_id TEXT,
    owner_id TEXT,
    -- checking | in_review | approved | rejected | appealed | post_review | shadow (recorded only)
    status TEXT NOT NULL,
    mode TEXT NOT NULL,                     -- 'shadow' | 'enforce_nsfw' | 'enforce' when queued
    timing TEXT NOT NULL DEFAULT 'pre',     -- 'pre' | 'post' (trusted channel)
    trigger TEXT,                           -- 'upload' | 'metadata_edit' | 'resubmit' | 'live_vod' | 'thumbnail' | 'image'
    route TEXT,                             -- automated outcome: 'approve' | 'hold' (shadow: what would have happened)
    risk REAL,
    nsfw INTEGER NOT NULL DEFAULT 0,
    escalate INTEGER NOT NULL DEFAULT 0,    -- senior reviewers only (VR7)
    hold_cause TEXT,                        -- 'nsfw' | 'risk' | 'escalation' | 'check_failed' | 'budget' | 'appeal'
    top_category TEXT,
    findings_count INTEGER NOT NULL DEFAULT 0,
    partial INTEGER NOT NULL DEFAULT 0,     -- frames or audio could not be extracted
    models TEXT,                            -- comma-separated model ids used
    prompt_version TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    checked_at TEXT,
    sla_due_at TEXT,                        -- in_review: when a person should have decided (alerts)
    assigned_to TEXT,
    decided_at TEXT,
    decided_by TEXT,
    decision TEXT,                          -- 'approve' | 'reject'
    reason_code TEXT,                       -- shared-types REVIEW_REASON_CODES
    note TEXT,
    undo_until TEXT,                        -- the decision may be undone until then (10 minutes)
    appeal_of TEXT,                         -- an appeal row points at the rejected review
    appeal_message TEXT,
    media_purge_after TEXT,
    updated_at TEXT NOT NULL
);

-- The queue: Action needed (in_review / appealed), escalations first, oldest deadline first
CREATE INDEX IF NOT EXISTS idx_content_reviews_queue ON content_reviews(status, escalate DESC, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_content_reviews_subject ON content_reviews(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reviews_owner ON content_reviews(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reviews_decided ON content_reviews(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reviews_created ON content_reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_content_reviews_purge ON content_reviews(media_purge_after);

-- Flagged observations only (never every frame): what the reviewer sees on the frame strip,
-- transcript and metadata panels.
CREATE TABLE IF NOT EXISTS content_review_findings (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL,
    source TEXT NOT NULL,                   -- 'metadata' | 'thumbnail' | 'frame' | 'transcript' | 'image'
    category TEXT NOT NULL,
    score REAL NOT NULL,
    at_ms INTEGER,
    end_ms INTEGER,
    media_key TEXT,                         -- MEDIA_PRIVATE review/<videoId>/<rev>/... (purged with the media)
    text TEXT,                              -- flagged transcript / metadata span (purged with the media)
    quran_ref TEXT,
    model TEXT NOT NULL,
    rationale TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_review_findings_review ON content_review_findings(review_id, score DESC);
