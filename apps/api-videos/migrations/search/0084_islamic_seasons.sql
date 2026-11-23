-- E21.2a: admin-curated Islamic seasons (wiki Epic 21 §4 21.2 and §5.3). Ramadan, the first ten
-- days of Dhul-Hijjah and others: bilingual text, a source label, start/end dates (an override of
-- the provider's Hijri calendar) and ordered rails. Soft delete, purged after 30 days.
CREATE TABLE IF NOT EXISTS islamic_seasons (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title_en TEXT NOT NULL,
    title_ar TEXT NOT NULL,
    description_en TEXT NOT NULL DEFAULT '',
    description_ar TEXT NOT NULL DEFAULT '',
    source_en TEXT NOT NULL,
    source_ar TEXT NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    deleted_at TEXT,
    purge_after TEXT
) WITHOUT ROWID;
-- Public read: the published season covering a date
CREATE INDEX IF NOT EXISTS idx_islamic_seasons_state_start ON islamic_seasons (state, starts_on, id);
-- Purge of soft-deleted seasons
CREATE INDEX IF NOT EXISTS idx_islamic_seasons_purge ON islamic_seasons (purge_after) WHERE purge_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS islamic_season_items (
    season_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (season_id, position)
) WITHOUT ROWID;
