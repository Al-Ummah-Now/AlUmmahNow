-- Privacy footprints (#1073): where a user's data sits inside records keyed by
-- someone else, so account erasure finds it without listing whole buckets.
--
-- One row per (user, kind, target), added when a write names the user and
-- never removed by later edits (an unlike, a deleted comment): the erase reads
-- a superset and changes only what still names the user. The erase deletes the
-- user's rows last. Kinds (lib/privacy/footprints.ts):
--   video        videos/{target}: likes, dislikes, comments, comment reactions
--   channel      channels/{target}: legacy subscriptions[] entries
--   post         community_posts comments/, likes/, votes/, comment-likes/ of post {target}
--   post-author  community_posts {target} (a posts/{channelId}/{postId}.json key)
--   playlist     playlists/{target}
--   report       reports report:{target}:... and claims/{target}/... (target = entity id)
--
-- A bucket's rows are trusted only once a backfill pass over it finished
-- (search_meta privacy:footprints:complete:<bucket>) and no write failed since
-- (privacy:footprints:invalid:<bucket>); until then the erase scans that bucket.
CREATE TABLE IF NOT EXISTS privacy_footprints (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_privacy_footprints_target ON privacy_footprints (kind, target_id);

-- Signature of the user set last recorded for a whole-record target (video,
-- channel): a write that does not change who is named costs one read.
CREATE TABLE IF NOT EXISTS privacy_footprint_sigs (
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  sig TEXT NOT NULL,
  PRIMARY KEY (kind, target_id)
) WITHOUT ROWID;
