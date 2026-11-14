-- CSAM response (docs/specs/CSAM-RESPONSE.md): cases, their append-only access log, and settings.
-- Super admins only (admin-api routers/csam.router.ts). No erasure or retention job deletes from
-- these tables: the retention sweep deletes the evidence (api-videos bucket) and closes the case.

CREATE TABLE IF NOT EXISTS csam_cases (
  id TEXT PRIMARY KEY,
  matched_url TEXT NOT NULL,
  -- Lowercased host + path: one open case per matched file
  url_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('paste', 'webhook')),
  status TEXT NOT NULL CHECK (status IN ('unmapped', 'containing', 'contained', 'containment_failed', 'reported', 'closed')),
  item_kind TEXT,
  -- CsamResolution JSON (item and uploader)
  resolution TEXT,
  uploader_id TEXT,
  job_id TEXT,
  -- {"ban": "...", "revoke_sessions": "<areq id>", "suspend_account": "<areq id>", "error": "..."}
  freeze TEXT,
  -- CsamReportFacts JSON, captured at mapping (before the takedown deletes the records)
  facts TEXT,
  detected_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  report_id TEXT,
  reported_at TEXT,
  reported_by TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0,
  legal_hold_reason TEXT,
  evidence_deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS csam_cases_open_url ON csam_cases (url_key) WHERE status != 'closed';
CREATE INDEX IF NOT EXISTS csam_cases_status ON csam_cases (status, created_at);
CREATE INDEX IF NOT EXISTS csam_cases_retention ON csam_cases (reported_at) WHERE evidence_deleted_at IS NULL AND legal_hold = 0;

CREATE TABLE IF NOT EXISTS csam_access_log (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS csam_access_log_case ON csam_access_log (case_id, created_at);

CREATE TRIGGER IF NOT EXISTS csam_access_log_no_update BEFORE UPDATE ON csam_access_log
BEGIN
  SELECT RAISE(ABORT, 'csam_access_log is append-only');
END;
CREATE TRIGGER IF NOT EXISTS csam_access_log_no_delete BEFORE DELETE ON csam_access_log
BEGIN
  SELECT RAISE(ABORT, 'csam_access_log is append-only');
END;

-- retention_days (365..3650, default 365); webhook_secret_sha256 (hex of the Cloudflare webhook secret)
CREATE TABLE IF NOT EXISTS csam_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
