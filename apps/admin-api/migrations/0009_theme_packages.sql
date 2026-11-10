-- Theme packages made in the admin theme builder (docs/themes/README.md). Files live in R2
-- (binding theme_packages): themes/<id>/draft/... for the draft, themes/<id>/<version>/... per
-- published version, which never changes. Built-in themes ship in the code and have no rows here.
CREATE TABLE IF NOT EXISTS theme_packages (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    based_on TEXT,
    latest_version TEXT,
    draft_updated_by TEXT NOT NULL,
    draft_updated_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- One row per published version.
CREATE TABLE IF NOT EXISTS theme_package_versions (
    theme_id TEXT NOT NULL,
    version TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    published_by TEXT NOT NULL,
    published_at TEXT NOT NULL,
    PRIMARY KEY (theme_id, version)
);
