/**
 * Social import sources (wiki TOOLS-ADMIN TA-9): public feeds of a channel's owner, imported as the
 * channel's community posts (videos through the normal upload path), on demand and on a schedule.
 *
 * Stored in api-videos SEARCH_DB (migration search/0081_import_sources.sql); managed by super admins
 * (`import_sources:manage`) through admin-api /api/admin/import/sources*; synced by the admin job
 * 'import.source-sync'. Nothing is scraped from web pages: each network is read through its public
 * API or feed, and only for a channel whose owner authorized the source.
 */

/** Where a source is read from. X, Meta and TikTok are never imported (wiki: Social import). */
export const IMPORT_SOURCE_NETWORKS = ['rss', 'bluesky', 'mastodon', 'telegram', 'youtube'] as const;
export type ImportSourceNetwork = (typeof IMPORT_SOURCE_NETWORKS)[number];

export const IMPORT_SOURCE_SCHEDULES = ['manual', 'hourly', 'daily', 'weekly'] as const;
export type ImportSourceSchedule = (typeof IMPORT_SOURCE_SCHEDULES)[number];

/** Seconds between scheduled syncs. */
export const IMPORT_SOURCE_INTERVAL_SECONDS: Readonly<Record<Exclude<ImportSourceSchedule, 'manual'>, number>> = {
  hourly: 3600,
  daily: 86_400,
  weekly: 604_800,
};

/**
 * How the owner authorized the source: they connected the account themselves (Studio → Social
 * connections, or the YouTube import's Google consent), or a super admin recorded their written
 * permission (who, when, a note; audited).
 */
export type ImportSourceAuth = 'connected' | 'recorded';

/** What a source item became. */
export type ImportItemKind = 'text' | 'image' | 'link' | 'video';
/**
 * pending: fetched, not posted yet. posted: its post (and video) exist. skipped: not imported, with a
 * reason in `note`. awaiting_file: the file has to come from the owner (YouTube: the Takeout export,
 * matched by the app; Telegram: a video over the Bot API's 20 MB download limit).
 */
export type SourceItemState = 'pending' | 'posted' | 'skipped' | 'awaiting_file';

/** Why an item was skipped or waits for its file. */
export const IMPORT_ITEM_NOTES = [
  'too_large_for_bot_api',
  'takeout_file',
  'too_large',
  'unsupported_media',
  'empty',
  'reply_or_repost',
  'posted_by_us',
  'media_unavailable',
  'post_refused',
] as const;
export type ImportItemNote = (typeof IMPORT_ITEM_NOTES)[number];

/** Largest video taken from a source; a bigger file waits for the owner to drop it into the app. */
export const IMPORT_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
/** Largest image copied to the media host. */
export const IMPORT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Items posted per job step (the job continues in further steps). */
export const IMPORT_POSTS_PER_STEP = 10;

export interface ImportSourceView {
  id: string;
  channelId: string;
  network: ImportSourceNetwork;
  /** Feed URL (rss), handle or DID (bluesky), @user@instance (mastodon), chat id (telegram), channel id (youtube) */
  address: string;
  label: string;
  auth: ImportSourceAuth;
  socialAccountId: string | null;
  ytImportId: string | null;
  permission: { by: string; note: string; at: string } | null;
  schedule: ImportSourceSchedule;
  enabled: boolean;
  nextSyncAt: string | null;
  lastSyncAt: string | null;
  lastJobId: string | null;
  lastError: string | null;
  counts: Partial<Record<SourceItemState, number>>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportSourceItemView {
  sourceId: string;
  itemId: string;
  kind: ImportItemKind | null;
  state: SourceItemState;
  note: ImportItemNote | null;
  postId: string | null;
  videoId: string | null;
  originalUrl: string | null;
  originalAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A source the channel's owner could import from, because they connected the account (GET …/connections). */
export interface ImportSourceConnection {
  network: ImportSourceNetwork;
  address: string;
  label: string;
  socialAccountId: string | null;
  ytImportId: string | null;
}

export interface CreateImportSourceRequest {
  channelId: string;
  network: ImportSourceNetwork;
  address: string;
  label?: string;
  schedule?: ImportSourceSchedule;
  /** Required for `recorded`: whose permission, and what they agreed to */
  permission?: { by: string; note: string };
}

export interface UpdateImportSourceRequest {
  label?: string;
  schedule?: ImportSourceSchedule;
  enabled?: boolean;
}

/**
 * Marker on a post (and a video) imported from a source: the original's link and publish time
 * ("First posted on Bluesky, 12 Nov 2026"). A video brought by the YouTube import keeps its own
 * marker (youtube-import.ts ImportedFrom).
 */
export interface SourceImportedFrom {
  platform: Exclude<ImportSourceNetwork, 'youtube'>;
  url: string | null;
  postedAt: string | null;
  sourceId: string;
}

export function isImportSourceNetwork(value: unknown): value is ImportSourceNetwork {
  return typeof value === 'string' && (IMPORT_SOURCE_NETWORKS as readonly string[]).includes(value);
}

export function isImportSourceSchedule(value: unknown): value is ImportSourceSchedule {
  return typeof value === 'string' && (IMPORT_SOURCE_SCHEDULES as readonly string[]).includes(value);
}

/** When a source syncs next after `from` (ms), or null for a manual one. */
export function nextImportSyncAt(schedule: ImportSourceSchedule, from: number): number | null {
  return schedule === 'manual' ? null : from + IMPORT_SOURCE_INTERVAL_SECONDS[schedule] * 1000;
}

// --- YouTube Takeout files (wiki TOOLS-ADMIN TA-9/TA-13) -------------------------------------------
//
// A YouTube source's records wait for their file (`awaiting_file`, note `takeout_file`): YouTube's terms
// forbid downloading, so the file comes from the owner's Google Takeout export. The app lists the export's
// videos (with what its metadata says about each), the server's queued job 'import.takeout-match' matches
// them to the records, the admin settles the ambiguous ones, the app uploads each matched file through the
// normal upload, and the same job posts the record's video on the channel.

/**
 * new: listed, not matched yet. matched: one record (by `matchedBy`). unmatched: no record (see `note`).
 * ambiguous: several records could be it (`candidates`); an admin picks one. uploading: the app has the
 * upload open. uploaded: the app sent the whole file; the job posts it. attached: the record's video post
 * exists. failed: the post could not be made (see `note`; Retry on the job).
 */
export const TAKEOUT_FILE_STATES = ['new', 'matched', 'unmatched', 'ambiguous', 'uploading', 'uploaded', 'attached', 'failed'] as const;
export type TakeoutFileState = (typeof TAKEOUT_FILE_STATES)[number];

/** How a file was matched: the Takeout video id, a video id in the file name, the title (and duration), or an admin's choice. */
export type TakeoutMatchedBy = 'video_id' | 'file_name' | 'title' | 'admin';

/**
 * Why a file is unmatched, ambiguous or failed. no_record: no record of this source has that video.
 * has_file: its record already has its video. several_records: more than one record fits.
 * file_taken: another file of this export already matched that record. upload_incomplete: the video's
 * upload has not finished. post_refused: the post or video was refused.
 */
export const TAKEOUT_FILE_NOTES = ['no_record', 'has_file', 'several_records', 'file_taken', 'upload_incomplete', 'post_refused'] as const;
export type TakeoutFileNote = (typeof TAKEOUT_FILE_NOTES)[number];

/** Files listed per request (a bigger export is listed in several requests). */
export const TAKEOUT_MAX_FILES_PER_REQUEST = 500;
/** Files matched per job step. */
export const TAKEOUT_MATCH_PER_STEP = 100;
/** Two durations within this many milliseconds are the same video (Takeout's duration is approximate). */
export const TAKEOUT_DURATION_TOLERANCE_MS = 2000;

/** One video file of the export, as the app read it (the file name and size, and its metadata row when found). */
export interface TakeoutFileInput {
  /** The file's name in the export (no folders), e.g. `My talk.mp4` */
  name: string;
  size: number;
  /** The export metadata's "Video ID", when the app found the file's row */
  videoId?: string | null;
  /** The metadata's original title, else the file name without its extension */
  title?: string | null;
  /** The metadata's "Approx Duration (ms)", or the file's own duration */
  durationMs?: number | null;
  mimeType?: string | null;
}

/** A record a file could be: the source item, with what the admin needs to choose. */
export interface TakeoutCandidate {
  itemId: string;
  title: string | null;
  originalUrl: string | null;
  originalAt: string | null;
}

export interface TakeoutFileView {
  id: string;
  sourceId: string;
  name: string;
  size: number;
  videoId: string | null;
  title: string | null;
  durationMs: number | null;
  state: TakeoutFileState;
  matchedBy: TakeoutMatchedBy | null;
  note: TakeoutFileNote | null;
  /** The record it matched (matched and after) */
  itemId: string | null;
  /** The record's title and link, for the list */
  item: TakeoutCandidate | null;
  /** ambiguous: the records it could be */
  candidates: TakeoutCandidate[];
  /** The video made from the file (uploading and after) */
  uploadVideoId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET …/takeout: the source's listed files, how many are in each state, and the latest match job. */
export interface TakeoutReport {
  files: TakeoutFileView[];
  counts: Partial<Record<TakeoutFileState, number>>;
  jobId: string | null;
}
