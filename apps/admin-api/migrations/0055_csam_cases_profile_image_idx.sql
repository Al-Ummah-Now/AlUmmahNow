-- The review queue finds the cases about an account's own images by the account (lib/csam.ts noCaseAboutReviewSql).
CREATE INDEX IF NOT EXISTS idx_csam_cases_profile_image ON csam_cases(uploader_id) WHERE item_kind = 'profile_image';
