-- Queue-message archive titles (#1254). Expand-only: one new table and an index.
-- One row per archived message that carries a creator's titles or channel names (title,
-- videoTitle, channelName_<lang>...): the archive key, under the SHA-256 subject of each person
-- the titled content belongs to (archive_subjects.subject, never a raw id). Erasing the account
-- reads its rows (primary-key range, never a scan), replaces those titles with "erased video" /
-- "erased channel" placeholders in R2 and deletes the rows. Rows older than the archive's
-- retention are purged by the daily cron.
CREATE TABLE IF NOT EXISTS archive_title_refs (
  subject TEXT NOT NULL,       -- archive_subjects.subject of the content's owner
  archive_key TEXT NOT NULL,   -- R2 key in al-ummah-now-messages
  created_at INTEGER NOT NULL,
  PRIMARY KEY (subject, archive_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_archive_title_refs_created ON archive_title_refs (created_at);
