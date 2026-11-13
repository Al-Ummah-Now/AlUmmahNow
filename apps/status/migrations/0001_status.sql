-- Public status page (apps/status, docs/status-page/README.md).
-- Written by the status Worker's cron (checks) and by admin-api (incidents, STATUS_DB).

-- Current debounced state per component: one row each, rewritten every check run
CREATE TABLE component_state (
  component TEXT PRIMARY KEY,
  -- What the public page shows (after debounce)
  state TEXT NOT NULL CHECK (state IN ('operational', 'degraded', 'partial', 'major')),
  -- The last raw check result and how many runs in a row returned it
  raw TEXT NOT NULL CHECK (raw IN ('operational', 'degraded', 'partial', 'major', 'unknown')),
  streak INTEGER NOT NULL DEFAULT 0,
  since TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  latency_ms INTEGER,
  detail TEXT,
  -- Set while an admin alert is open for this component (Errors page needs-action key status:<component>)
  alert_open INTEGER NOT NULL DEFAULT 0
);

-- One row per component per UTC day: how many runs ended in each (debounced) state
CREATE TABLE daily (
  component TEXT NOT NULL,
  day TEXT NOT NULL,
  operational INTEGER NOT NULL DEFAULT 0,
  degraded INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  major INTEGER NOT NULL DEFAULT 0,
  maintenance INTEGER NOT NULL DEFAULT 0,
  unknown INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  latency_n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (component, day)
);
CREATE INDEX daily_day ON daily (day);

-- Incidents and scheduled maintenance, written by admins (videos admin → admin-api)
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('incident', 'maintenance')),
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  -- incident: investigating | identified | monitoring | resolved; maintenance: scheduled | in_progress | completed
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed')),
  impact TEXT NOT NULL CHECK (impact IN ('none', 'degraded', 'partial', 'major', 'maintenance')),
  -- JSON array of component ids
  components TEXT NOT NULL DEFAULT '[]',
  -- maintenance window (incidents: started_at = when it began)
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  -- Soft delete: hidden from the public page, restorable for 30 days, then purged by the status cron
  deleted_at TEXT,
  deleted_by TEXT
);
CREATE INDEX incidents_open ON incidents (deleted_at, resolved_at, starts_at);
CREATE INDEX incidents_starts ON incidents (starts_at);

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX incident_updates_incident ON incident_updates (incident_id, created_at);
