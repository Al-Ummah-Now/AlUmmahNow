-- Reviewers who get an instant alert (in-app + push) when a video is held for a person
-- (wiki AUN-VIDEO-REVIEW, VR6/VR7). admin-api adds a reviewer when they turn alerts on in the
-- review queue (web or native); the processor reads it on every hold. Seniors also get escalations.
CREATE TABLE IF NOT EXISTS review_alert_subscribers (
    user_id TEXT PRIMARY KEY,
    senior INTEGER NOT NULL DEFAULT 0,      -- senior_reviewer: also escalations (minors, extremism)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
