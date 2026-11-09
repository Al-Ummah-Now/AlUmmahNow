-- What the Studio Videos tab filters on (docs/specs/CREATOR-STUDIO.md §4.4.1, §8.1).
-- studio_status holds the one status a video is in; the rule lives in
-- studioVideoStatus (packages/shared-types/src/search/ownership.ts).
ALTER TABLE content_ownership ADD COLUMN studio_status TEXT;
ALTER TABLE content_ownership ADD COLUMN category TEXT;
ALTER TABLE content_ownership ADD COLUMN language TEXT;

CREATE INDEX IF NOT EXISTS idx_content_ownership_channel_status
  ON content_ownership (kind, channel_id, studio_status, created_at);

-- Existing rows are filled by scripts/release/content-columns.ts after the new
-- worker is live. The ownership index stays trusted throughout, because no
-- existing column changes.
