-- Move from YouTube (wiki AUN-YT-IMPORT, docs/features/youtube-import.md).
--
-- One import per creator connection to one channel. The snapshot of the creator's YouTube
-- videos and playlists lives here while the import runs; the Google refresh token is stored
-- encrypted (AES-GCM, key derived from the OAuth client secret) and deleted when the import
-- finishes or is cancelled. The uploaded videos themselves are ordinary R2 videos.

CREATE TABLE IF NOT EXISTS yt_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  -- The channel owner: imports run under the owner's creator tier, like uploads
  owner_id TEXT NOT NULL,
  -- listing | ready | importing | finished | cancelled | failed
  status TEXT NOT NULL,
  -- { id, title, thumbnailUrl, videoCount, uploadsPlaylistId }
  yt_channel_json TEXT,
  captions INTEGER NOT NULL DEFAULT 0,
  -- keep | private
  visibility_mode TEXT NOT NULL DEFAULT 'keep',
  refresh_token_enc TEXT,
  token_iv TEXT,
  scopes TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  -- When the finished import's YouTube metadata snapshot was emptied (privacy: kept 30 days)
  snapshot_purged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_yt_imports_user_channel ON yt_imports (user_id, channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_yt_imports_status ON yt_imports (status, updated_at);

-- Pending Google consents (PKCE verifier + where to land); single use, 15 minutes
CREATE TABLE IF NOT EXISTS yt_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  captions INTEGER NOT NULL DEFAULT 0,
  verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_yt_oauth_states_expires ON yt_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS yt_import_items (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  yt_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  title_localized TEXT,
  description_localized TEXT,
  tags TEXT,
  language TEXT,
  published_at TEXT,
  publish_at TEXT,
  duration_seconds INTEGER,
  yt_visibility TEXT NOT NULL,
  made_for_kids INTEGER NOT NULL DEFAULT 0,
  thumbnail_url TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  match_json TEXT,
  video_id TEXT,
  -- available | selected | uploading | processing | ready | failed | imported
  state TEXT NOT NULL DEFAULT 'available',
  thumbnail_state TEXT NOT NULL DEFAULT 'none',
  captions_state TEXT NOT NULL DEFAULT 'none',
  -- Caption languages staged from YouTube (JSON array) and those attached to the video
  caption_languages TEXT,
  captions_attached TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (import_id, yt_video_id)
);
CREATE INDEX IF NOT EXISTS idx_yt_import_items_import ON yt_import_items (import_id, published_at);
CREATE INDEX IF NOT EXISTS idx_yt_import_items_channel_video ON yt_import_items (channel_id, yt_video_id);
CREATE INDEX IF NOT EXISTS idx_yt_import_items_video ON yt_import_items (video_id) WHERE video_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS yt_import_playlists (
  import_id TEXT NOT NULL,
  yt_playlist_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  yt_visibility TEXT NOT NULL,
  -- YouTube video ids in playlist order (JSON array)
  video_ids_json TEXT NOT NULL DEFAULT '[]',
  selected INTEGER NOT NULL DEFAULT 0,
  playlist_id TEXT,
  -- none | pending | done | failed
  state TEXT NOT NULL DEFAULT 'none',
  PRIMARY KEY (import_id, yt_playlist_id)
);

-- Whether a tier's YouTube imports count against its hourly/daily upload limits (1, default) or not (0)
ALTER TABLE creator_tiers ADD COLUMN import_counts_limits INTEGER NOT NULL DEFAULT 1;
