-- Records each account's acceptance of the Terms of Service and Community Guidelines
-- before its first upload or channel creation (Play UGC policy, AlUmmahNowAndroid#65).
-- Point-lookup by user_id PK only (no table scans).
CREATE TABLE IF NOT EXISTS creator_terms_acceptances (
  user_id TEXT PRIMARY KEY,
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL
) WITHOUT ROWID;
