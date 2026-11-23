/**
 * Social import sources (wiki TOOLS-ADMIN TA-9): public feeds of a channel's owner, imported as the
 * channel's community posts (videos through the normal upload path), on demand and on a schedule.
 *
 * Stored in api-videos SEARCH_DB (migration search/0080_import_sources.sql); managed by super admins
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
