-- What the container saw in the source of a failed transcode (shared-types TranscodeSourceFacts, JSON): container
-- kind, streams, share of zero bytes, SHA-256. Admin troubleshooting only. Expand-only.
ALTER TABLE media_jobs ADD COLUMN source_facts TEXT;
