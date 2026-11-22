-- Translate from the published track (TA-20, wiki AUN-CAPTIONS §5.7).
--
-- A translate job reads the source language's caption draft when it has one. Without a draft
-- (captions imported as sidecar files, or uploaded) it reads the published track instead, copied
-- into the job's work prefix when it is sent. source_kind records which: 'published', or NULL for
-- the draft (every older row). An admin's Retry needs it to copy the track again.
ALTER TABLE caption_jobs ADD COLUMN source_kind TEXT CHECK (source_kind IS NULL OR source_kind = 'published');
