-- Who uploaded each image served from images.alummahnow.net (docs/specs/CSAM-RESPONSE.md §3).
-- Avatar, cover and post-image paths carry only a random id, so a matched URL is mapped to its
-- uploader through this index. Written on upload; filled for older images by the
-- images.index-owners admin job. Rows go with the account on erasure (lib/privacy).
-- (0033 is taken by caption jobs, AlUmmahNow#1318.)

CREATE TABLE IF NOT EXISTS image_owners (
  -- Path on the image host, with its leading slash (`/<uuid>_avatar.jpg`)
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('profile_avatar', 'profile_cover', 'channel_avatar', 'channel_cover', 'post_image', 'video_thumbnail')),
  owner_id TEXT,
  channel_id TEXT,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_image_owners_owner ON image_owners (owner_id);
