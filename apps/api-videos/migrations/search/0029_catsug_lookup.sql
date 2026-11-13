-- The category-suggestion cache lookup
--   SELECT * FROM category_suggestions WHERE input_hash = ? AND status = 'done'
--     AND prompt_version = ? ORDER BY updated_at DESC LIMIT ?
-- used idx_catsug_hash (input_hash only). E2E videos share titles, so one hash
-- matches thousands of rows and each lookup read ~5.6k rows (65M rows read on
-- QA on 2026-11-12). With every filter and the sort key in the index the
-- lookup reads only the rows it returns.
-- Expand-only: a new index, no table or data change.
CREATE INDEX IF NOT EXISTS idx_catsug_hash_done ON category_suggestions (input_hash, prompt_version, status, updated_at);
