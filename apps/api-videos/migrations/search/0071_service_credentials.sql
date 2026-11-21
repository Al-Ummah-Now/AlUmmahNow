-- Service keys a super admin sets in the videos admin (AUN-CAPTIONS DEEPL-KEY): today the DeepL API
-- key on Caption settings. Expand-only: one new table.
--
-- The value is AES-256-GCM sealed (packages/shared-types service-credentials.ts) under the
-- environment's INTERNAL_API_KEY; admin-api writes it, api-videos and the processor open it in
-- memory per job. Never returned to a browser: only last4, the plan, who set it and when, the last test.
CREATE TABLE IF NOT EXISTS service_credentials (
  provider TEXT PRIMARY KEY CHECK (provider IN ('deepl')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  last4 TEXT NOT NULL,
  plan TEXT,                      -- DeepL: 'free' (key ends in ':fx') | 'pro'
  updated_by TEXT NOT NULL,
  updated_by_name TEXT,
  updated_at TEXT NOT NULL,
  test_ok INTEGER,
  test_code TEXT,                 -- ok | invalid | quota | rate_limited | unavailable | unreachable | unreadable
  test_detail TEXT,               -- JSON { characterCount, characterLimit } of the last test (no key, no body)
  test_at TEXT
);
