-- R2 backfill of existing videos (AUN-R2-MIGRATION, docs/media-delivery/BACKFILL.md).
-- A run is started by an admin from the videos admin Backfill page; its items move through
-- pending → copying → transcoding → verifying → verified (or failed / skipped / cancelled).
CREATE TABLE media_backfill_runs (
	id TEXT PRIMARY KEY,
	status TEXT NOT NULL,
	scope TEXT NOT NULL,
	settings TEXT NOT NULL,
	estimate TEXT,
	-- estimation cursor: the last video id read from the scope
	cursor TEXT,
	created_by TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	stop_reason TEXT,
	-- last tick of the run's queue loop (the cron restarts a loop that went quiet)
	tick_at TEXT,
	last_start_at TEXT
) WITHOUT ROWID;

CREATE INDEX idx_media_backfill_runs_status ON media_backfill_runs (status, created_at);

CREATE TABLE media_backfill_items (
	run_id TEXT NOT NULL,
	video_id TEXT NOT NULL,
	state TEXT NOT NULL,
	skip_reason TEXT,
	title TEXT,
	channel_id TEXT,
	library_id INTEGER,
	duration_seconds REAL,
	source_bytes INTEGER,
	source_file TEXT,
	has_original INTEGER NOT NULL DEFAULT 0,
	needs_transcode INTEGER NOT NULL DEFAULT 1,
	est_usd REAL NOT NULL DEFAULT 0,
	-- the copy: upload id of our original and the MD5 of every part, as JSON { "<offset>": "<md5>" }
	upload_id TEXT,
	copied_bytes INTEGER NOT NULL DEFAULT 0,
	parts TEXT,
	job_id TEXT,
	-- actual spend inputs
	egress_bytes INTEGER NOT NULL DEFAULT 0,
	container_seconds INTEGER NOT NULL DEFAULT 0,
	stored_bytes INTEGER NOT NULL DEFAULT 0,
	class_a_ops INTEGER NOT NULL DEFAULT 0,
	spent_usd REAL NOT NULL DEFAULT 0,
	attempts INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	error_step TEXT,
	checks TEXT,
	started_at TEXT,
	verified_at TEXT,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (run_id, video_id)
) WITHOUT ROWID;

CREATE INDEX idx_media_backfill_items_state ON media_backfill_items (run_id, state, updated_at);

-- The latest verification of each video's R2 copy (valid while the record's r2.rev is `rev`).
CREATE TABLE media_r2_verified (
	video_id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	rev TEXT NOT NULL,
	library_id INTEGER,
	channel_id TEXT,
	verified_at TEXT NOT NULL,
	checks TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_media_r2_verified_library ON media_r2_verified (library_id, video_id);

-- Removing verified videos from a Bunny library (retiring it): only after the grace period.
CREATE TABLE media_bunny_removals (
	video_id TEXT PRIMARY KEY,
	library_id INTEGER NOT NULL,
	-- Bunny GUID, filled in when the removal runs
	guid TEXT,
	status TEXT NOT NULL,
	scheduled_by TEXT NOT NULL,
	scheduled_at TEXT NOT NULL,
	delete_after TEXT NOT NULL,
	removed_at TEXT,
	attempts INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_media_bunny_removals_due ON media_bunny_removals (status, delete_after);
CREATE INDEX idx_media_bunny_removals_library ON media_bunny_removals (library_id, status);
