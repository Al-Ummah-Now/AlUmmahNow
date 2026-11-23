-- Covering index for GET /api/v1/quran/credits (DISTINCT lang, qf_translation_id, name)
-- so public credits reads never full-table-scan channel_quran_translations.
-- Expand-only: a new index.
CREATE INDEX IF NOT EXISTS idx_channel_quran_translations_edition
  ON channel_quran_translations (lang, qf_translation_id, name);
