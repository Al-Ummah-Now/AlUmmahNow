-- Error reporting (admin-web /errors). Every app reports errors to admin-api
-- POST /internal/errors; events are grouped by fingerprint here.
-- Expand-only: new tables, nothing existing changes.

-- One row per distinct error (fingerprint = app + error name + normalised
-- message + top stack frames + normalised route) per environment.
CREATE TABLE IF NOT EXISTS error_groups (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    environment TEXT NOT NULL,
    app TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT,
    -- Latest scrubbed message, the first app stack frame and the normalised route
    message TEXT NOT NULL,
    culprit TEXT,
    route TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved', 'ignored')),
    occurrences INTEGER NOT NULL DEFAULT 0,
    -- Distinct accounts / anonymous visitors (capped at 10000)
    users INTEGER NOT NULL DEFAULT 0,
    -- Stored samples in error_events (bounded per group)
    samples INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    first_release TEXT,
    last_release TEXT,
    -- Resolve: reopens when it recurs in a release first seen after resolved_release
    resolved_at TEXT,
    resolved_release TEXT,
    regressed_at TEXT,
    assignee_id TEXT,
    assignee_email TEXT,
    last_alert_at TEXT,
    -- 1 while every occurrence came from the release E2E's controlled errors
    test INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE (environment, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_last_seen ON error_groups (last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_status ON error_groups (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_app ON error_groups (app, last_seen DESC);

-- Raw samples (scrubbed), at most 50 per group, kept 30 days.
CREATE TABLE IF NOT EXISTS error_events (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
    ref TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    release TEXT,
    worker_version TEXT,
    environment TEXT,
    route TEXT,
    method TEXT,
    status INTEGER,
    locale TEXT,
    theme TEXT,
    browser TEXT,
    os TEXT,
    user_id TEXT,
    request_id TEXT,
    name TEXT,
    message TEXT NOT NULL,
    stack TEXT,
    -- Stack mapped to original sources with the release's private source maps
    symbolicated_stack TEXT,
    shown INTEGER NOT NULL DEFAULT 0,
    extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_events_group ON error_events (group_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_received ON error_events (received_at);
CREATE INDEX IF NOT EXISTS idx_error_events_request ON error_events (request_id);

-- Every reference a user was given or an event carried → its group (30 days),
-- so support finds the group even after the sample was trimmed.
CREATE TABLE IF NOT EXISTS error_refs (
    ref TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    event_id TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_refs_created ON error_refs (created_at);
CREATE INDEX IF NOT EXISTS idx_error_refs_group ON error_refs (group_id);

-- Distinct affected users per group: usr_ ids, or a salted hash for anonymous visitors.
CREATE TABLE IF NOT EXISTS error_group_users (
    group_id TEXT NOT NULL,
    user_key TEXT NOT NULL,
    PRIMARY KEY (group_id, user_key)
);

-- Occurrences per release, per group.
CREATE TABLE IF NOT EXISTS error_group_releases (
    group_id TEXT NOT NULL,
    release TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (group_id, release)
);

-- Occurrences per UTC hour, per group (sparklines, timeline, spike alerts), kept 30 days.
CREATE TABLE IF NOT EXISTS error_hourly (
    group_id TEXT NOT NULL,
    hour TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, hour)
);

CREATE INDEX IF NOT EXISTS idx_error_hourly_hour ON error_hourly (hour);

-- When each release of each app was first seen: orders releases for "recurred in a newer release".
CREATE TABLE IF NOT EXISTS error_releases (
    environment TEXT NOT NULL,
    app TEXT NOT NULL,
    release TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    PRIMARY KEY (environment, app, release)
);

-- Audit log and timeline of a group: status changes, assignment, notes,
-- automatic reopenings and alert mails.
CREATE TABLE IF NOT EXISTS error_group_activity (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'assign', 'note', 'reopened', 'alert', 'retry', 'item')),
    from_status TEXT,
    to_status TEXT,
    body TEXT,
    actor_id TEXT,
    actor_email TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_group_activity_group ON error_group_activity (group_id, created_at);

-- Fixed-window counters for ingest rate limits and alert mail limits.
CREATE TABLE IF NOT EXISTS error_rate (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_rate_expires ON error_rate (expires_at);

-- "Needs action" items (kind = 'action' events): a failed job, a dead-lettered
-- message, an email not sent, an AI step or an admin job that failed. One row
-- per item key, under its group, with a link to the item and an optional
-- Retry action that only admin-api runs (src/lib/errors-actions.ts).
CREATE TABLE IF NOT EXISTS error_actions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
    environment TEXT NOT NULL,
    item_key TEXT NOT NULL,
    app TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    -- Latest failure reason (scrubbed)
    detail TEXT,
    item_type TEXT,
    item_id TEXT,
    item_url TEXT,
    retry_json TEXT,
    retry_label TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retrying', 'resolved', 'dismissed')),
    occurrences INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    last_attempt_result TEXT,
    last_attempt_by TEXT,
    last_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE (environment, item_key)
);

CREATE INDEX IF NOT EXISTS idx_error_actions_group ON error_actions (group_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_actions_status ON error_actions (status, updated_at DESC);
