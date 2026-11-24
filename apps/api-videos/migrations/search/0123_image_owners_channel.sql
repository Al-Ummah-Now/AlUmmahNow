-- Account erasure and takedowns of the same media (apps/api-videos/src/lib/privacy/erase-media.ts).
-- A channel's images by the channel they were uploaded for: every avatar and cover ever uploaded for
-- an erased channel, whoever uploaded it.
CREATE INDEX IF NOT EXISTS idx_image_owners_channel ON image_owners (channel_id);

-- What an erasure wrote down to delete, per target and job (lib/privacy/erase-targets.ts). Expand-only: a
-- new table and indexes.
CREATE TABLE IF NOT EXISTS media_erase_targets (
  -- video (streams too) | channel | user (profile images) | post ('<channelId>/<postId>')
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- admin_jobs id: the user.erase-media job, a purge's, or a takedown's (its hold)
  job_id TEXT NOT NULL,
  -- When the record was written down for erasure (NULL: only an uploader or owner of a part)
  erased_at TEXT,
  -- JSON: its media, ids and paths only; cleared when the job is done
  media TEXT,
  -- admin_jobs id of the takedown that holds it
  held_by TEXT,
  -- A part of it is being deleted now, by this delivery
  claimed_at TEXT,
  claim_token TEXT,
  first_deleted_at TEXT,
  last_deleted_at TEXT,
  -- A part that stopped where it cannot be told what went
  stopped_at TEXT,
  PRIMARY KEY (target_kind, target_id, job_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_media_erase_targets_job ON media_erase_targets (job_id);

-- A takedown's job by its case (lib/csam/contain.ts containJobOf)
CREATE INDEX IF NOT EXISTS idx_admin_jobs_csam_case ON admin_jobs (json_extract(params, '$.caseId'), created_at) WHERE kind = 'csam.contain';
