-- Order guard for the search and ownership indexes (docs/architecture/SCALABILITY-AUDIT.md, PR-8).
--
-- Index writes arrive from many places at once (api-videos inline on every R2
-- write, processor SearchIndexSync messages from the scheduler and admin-api,
-- retries, backfills). Each used to apply whatever snapshot it carried, so a
-- late, older snapshot could overwrite a newer one: a video made private stayed
-- searchable, a deleted item came back.
--
-- source_version is the R2 `uploaded` time (epoch ms) of the object a row was
-- built from, or the time of a delete. A write applies only when its version
-- is not older than the row's, and not older than the item's last delete
-- (search_tombstones). Rows written before this migration have version 0, so
-- any versioned write replaces them.
ALTER TABLE search_videos ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_channels ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_playlists ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_posts ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_ownership ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0;

-- Last delete of an item, so an older snapshot cannot bring it back.
-- entity: 'video' | 'channel' | 'playlist' | 'post' (search index) or
-- 'own:video' | 'own:channel' (ownership index). Pruned after 30 days.
CREATE TABLE IF NOT EXISTS search_tombstones (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (entity, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_search_tombstones_version ON search_tombstones (version);
