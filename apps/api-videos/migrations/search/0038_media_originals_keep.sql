-- Originals that are the master of a video's only copy (docs/media-delivery/PROVIDERS.md §Ingest):
-- a video Bunny holds no copy of is played from R2 only, and its original is what a re-transcode
-- starts from, so retention never deletes it. Set by the retention sweep (lib/media/originals.ts),
-- which then skips the row; purging the video deletes it as before.
ALTER TABLE media_originals ADD COLUMN keep TEXT;
