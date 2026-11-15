-- Transcript translation (AUN-CAPTIONS §5.7, P3) and Quran translation editions (O7).
--
-- caption_jobs gains kind 'translate' (a creator's corrected source draft into another language),
-- the status 'translating', and the source draft it translates. SQLite cannot change a CHECK, so
-- the table is rebuilt with every row and both indexes kept.

CREATE TABLE caption_jobs_new (
  id TEXT PRIMARY KEY,
  -- sha256(videoId|kind|language|provider[|source]): one active job per key (the partial index below)
  idempotency_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  channel_id TEXT,
  subject_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcribe', 'translate')),
  -- The draft's language: the language spoken (transcribe) or the target (translate)
  language TEXT NOT NULL,
  replace_draft INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'waiting_budget', 'extracting', 'transcribing', 'translating', 'postprocessing', 'ready', 'failed', 'cancelled')),
  progress_done INTEGER,
  progress_total INTEGER,
  minutes_reserved INTEGER NOT NULL DEFAULT 0,
  minutes_charged INTEGER,
  waived INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  audio_manifest_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  -- translate: the source draft's language and the version translated
  source_language TEXT,
  source_version INTEGER
) WITHOUT ROWID;

INSERT INTO caption_jobs_new (id, idempotency_key, video_id, channel_id, subject_id, requested_by, kind, language, replace_draft, provider, model, status,
  progress_done, progress_total, minutes_reserved, minutes_charged, waived, error, audio_manifest_key, attempts, created_at, updated_at, finished_at)
SELECT id, idempotency_key, video_id, channel_id, subject_id, requested_by, kind, language, replace_draft, provider, model, status,
  progress_done, progress_total, minutes_reserved, minutes_charged, waived, error, audio_manifest_key, attempts, created_at, updated_at, finished_at
FROM caption_jobs;

DROP TABLE caption_jobs;
ALTER TABLE caption_jobs_new RENAME TO caption_jobs;
CREATE UNIQUE INDEX IF NOT EXISTS idx_caption_jobs_active ON caption_jobs (idempotency_key)
  WHERE status NOT IN ('ready', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_caption_jobs_video ON caption_jobs (video_id, created_at);

-- The platform's Quran Foundation translation edition per language (admin; O7). A language with
-- no row uses the shipped default (Saheeh International for English, shared-types
-- DEFAULT_QURAN_TRANSLATIONS); a language with no edition shows the Arabic text.
CREATE TABLE IF NOT EXISTS quran_translation_defaults (
  lang TEXT PRIMARY KEY,
  qf_translation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

-- A channel's own pick per language (Studio → Settings; O7), over the platform default.
CREATE TABLE IF NOT EXISTS channel_quran_translations (
  channel_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  qf_translation_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, lang)
) WITHOUT ROWID;

-- Inline title/description translation (§5.8, O5): Translate presses per user per UTC day, for the
-- daily fair-use limit. Cache hits are not counted. Old days are deleted as the next ones are written.
CREATE TABLE IF NOT EXISTS inline_translation_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  items INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

-- Audit of machine translations asked for (§5.8): who, what kind, which languages, provider and size.
-- Never the text. Kept 400 days; the user id is anonymised when the account is erased.
CREATE TABLE IF NOT EXISTS translation_audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inline', 'caption', 'viewer')),
  video_id TEXT,
  field TEXT,
  from_lang TEXT NOT NULL,
  to_lang TEXT NOT NULL,
  items INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cached INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_translation_audit_at ON translation_audit (at);
CREATE INDEX IF NOT EXISTS idx_translation_audit_user ON translation_audit (user_id, at);

-- Viewer-side machine translations of a video's title and description (§5.9, O6), apart from the
-- creator's own text and never written into titleLocalized. source_hash is sha256 of the title and
-- description translated: a later edit makes the row stale and it is asked for again.
CREATE TABLE IF NOT EXISTS metadata_translations (
  video_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, lang)
) WITHOUT ROWID;

-- A channel's opt-out of viewer-side translated titles (§5.9). No row = translations allowed
-- (when the admin switch is on).
CREATE TABLE IF NOT EXISTS channel_translation_settings (
  channel_id TEXT PRIMARY KEY,
  viewer_titles INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
