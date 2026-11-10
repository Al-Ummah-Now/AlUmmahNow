/**
 * Adding many videos to a channel playlist at once (api-videos playlist
 * router, web Manage Playlists / Video Management / upload flows).
 *
 * Shared so the web pages and the API agree on the caps and on the answer
 * the web turns into a friendly notice.
 */

/** Ids one request adds inline. Above it the add runs as a queued job. */
export const PLAYLIST_BULK_SYNC_MAX = 200;

/** Ids one bulk request (add, remove or create-with-videos) may carry. */
export const PLAYLIST_BULK_MAX = 1000;

/** Videos one playlist may hold. */
export const PLAYLIST_MAX_VIDEOS = 1000;

/** What happened to the ids of one bulk add. */
export interface PlaylistBulkAddResult {
  /**
   * `done`: every valid id is in the playlist now. `queued`: the add (or the
   * rest of it) runs in the background as `jobId`; the playlist fills in
   * shortly. `failed`: nothing could be queued either; the admin is flagged
   * and the caller may retry.
   */
  status: 'done' | 'queued' | 'failed';
  /** Ids this request put into the playlist, in the order given. */
  added: number;
  /** Ids that were already in the playlist (idempotent: not added twice). */
  alreadyInPlaylist: number;
  /** Ids that are not videos of the playlist's channel (deleted, hidden or another channel's): never added. */
  notInChannel: number;
  /** Ids left for the background job. */
  pending: number;
  /** The playlist's video count after this request. */
  videosCount: number;
  /** The background job, when `status` is `queued` (poll GET /api/playlists/:id/jobs/:jobId). */
  jobId?: string;
}

/** A background add as the playlist's managers see it (no admin internals). */
export interface PlaylistAddJobStatus {
  id: string;
  playlistId: string;
  status: 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed';
  /** Ids the job was given. */
  total: number;
  /** Ids handled so far (added, already there or skipped). */
  processed: number;
  added: number;
  notInChannel: number;
  updatedAt: string;
}

/** One entry of a playlist as its managers see it (GET /api/playlists/:id/items). */
export interface PlaylistManageItem {
  /** The video id stored in the playlist. */
  id: string;
  /** Position in the playlist (0-based). */
  position: number;
  /** The video, or null when it is gone, hidden or no longer viewable. */
  video: {
    id: string;
    title: string;
    titleLocalized?: Record<string, string>;
    thumbnailUrl?: string;
    duration?: number;
    isPublic?: boolean;
    isShort?: boolean;
    width?: number;
    height?: number;
    channelId?: string;
    uploadStatus?: string;
  } | null;
}

/**
 * The merge rule for a reorder racing other edits: ids in `requested` keep
 * that order, ids added meanwhile (not in `requested`) follow in their
 * current order, ids removed meanwhile are dropped, duplicates collapse.
 * So a reorder never loses a concurrent add or resurrects a removed video.
 */
export function mergePlaylistOrder(current: readonly string[], requested: readonly string[]): string[] {
  const present = new Set(current);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of requested) {
    if (!present.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const id of current) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

/** Ids in first-seen order without blanks or repeats (the order the user chose). */
export function uniqueVideoIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playlist order: manual, or automatic by a field in either direction
// ---------------------------------------------------------------------------

export const PLAYLIST_SORT_MODES = ['manual', 'auto'] as const;
export type PlaylistSortMode = (typeof PLAYLIST_SORT_MODES)[number];

/** Fields an automatic order can use. `added` is the date the video was added to the playlist. */
export const PLAYLIST_SORT_FIELDS = ['added', 'published', 'title', 'views', 'duration'] as const;
export type PlaylistSortField = (typeof PLAYLIST_SORT_FIELDS)[number];

export const PLAYLIST_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type PlaylistSortDirection = (typeof PLAYLIST_SORT_DIRECTIONS)[number];

/** How a playlist orders its videos, as stored on the playlist record. */
export interface PlaylistSort {
  sortMode: PlaylistSortMode;
  sortField: PlaylistSortField;
  sortDirection: PlaylistSortDirection;
}

/** New playlists, and old ones without a stored order, are manual. */
export const DEFAULT_PLAYLIST_SORT: PlaylistSort = { sortMode: 'manual', sortField: 'added', sortDirection: 'desc' };

/** The order a stored record uses; anything missing or unknown falls back to the default (manual). */
export function playlistSortOf(record: { sortMode?: unknown; sortField?: unknown; sortDirection?: unknown } | null | undefined): PlaylistSort {
  const mode = (PLAYLIST_SORT_MODES as readonly unknown[]).includes(record?.sortMode) ? (record!.sortMode as PlaylistSortMode) : DEFAULT_PLAYLIST_SORT.sortMode;
  const field = (PLAYLIST_SORT_FIELDS as readonly unknown[]).includes(record?.sortField) ? (record!.sortField as PlaylistSortField) : DEFAULT_PLAYLIST_SORT.sortField;
  const direction = (PLAYLIST_SORT_DIRECTIONS as readonly unknown[]).includes(record?.sortDirection) ? (record!.sortDirection as PlaylistSortDirection) : DEFAULT_PLAYLIST_SORT.sortDirection;
  return { sortMode: mode, sortField: field, sortDirection: direction };
}

/** The video fields an automatic order reads. */
export interface PlaylistSortVideo {
  title?: string | null;
  publishedAt?: string | null;
  dateCreated?: string | null;
  views?: number | null;
  duration?: number | null;
}

/**
 * Arabic and English titles in one list, the same for every viewer (the
 * server sorts once): Arabic script first, then Latin (the ar collation),
 * base letters only (case and diacritics ignored), numbers by value
 * ("Part 2" before "Part 10").
 */
const TITLE_COLLATOR = new Intl.Collator(['ar', 'en'], { sensitivity: 'base', numeric: true, ignorePunctuation: true });

/** Before any real date: undated adds sort as the oldest. */
const UNDATED_ADD_BASE = -1e15;

/** Comparison key of one video for `field`, or null when unknown (unknown values always sort last). */
function sortKey(field: PlaylistSortField, video: PlaylistSortVideo | null | undefined, addedAt: string | undefined, index: number): number | string | null {
  switch (field) {
    case 'added': {
      // Entries stored before the playlist recorded dates are its oldest, in stored order
      const ms = addedAt ? Date.parse(addedAt) : NaN;
      return Number.isFinite(ms) ? ms : UNDATED_ADD_BASE + index;
    }
    case 'published': {
      const ms = Date.parse(video?.publishedAt || video?.dateCreated || '');
      return Number.isFinite(ms) ? ms : null;
    }
    case 'title':
      return video?.title?.trim() ? video.title.trim() : null;
    case 'views':
      return typeof video?.views === 'number' && Number.isFinite(video.views) ? video.views : video ? 0 : null;
    case 'duration':
      return typeof video?.duration === 'number' && Number.isFinite(video.duration) ? video.duration : null;
  }
}

/**
 * The playlist's ids in the order its sort asks for. Manual keeps `ids` as
 * stored. Automatic sorts by the field and direction; ties, and entries with
 * no value (unavailable videos, unknown duration), keep their stored
 * relative order, the latter after every entry with a value. Ids added
 * before the playlist recorded add dates count as its oldest. Pure and stable: the same input always
 * gives the same order, so pages cut after sorting never overlap or skip.
 */
export function sortPlaylistVideoIds(
  ids: readonly string[],
  sort: PlaylistSort,
  videoOf: (id: string) => PlaylistSortVideo | null | undefined,
  addedAt: Readonly<Record<string, string>> = {},
): string[] {
  if (sort.sortMode !== 'auto') return [...ids];
  const sign = sort.sortDirection === 'desc' ? -1 : 1;
  const rows = ids.map((id, index) => ({ id, index, key: sortKey(sort.sortField, videoOf(id), addedAt[id], index) }));
  rows.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key === null && b.key === null) return a.index - b.index;
      return a.key === null ? 1 : -1;
    }
    const diff = typeof a.key === 'string' && typeof b.key === 'string'
      ? TITLE_COLLATOR.compare(a.key, b.key)
      : (a.key as number) - (b.key as number);
    return diff !== 0 ? sign * diff : a.index - b.index;
  });
  return rows.map((r) => r.id);
}
