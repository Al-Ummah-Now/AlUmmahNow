/**
 * Watch page "related" shelf (Epic 7.3): videos similar to the one playing,
 * from GET /api/recommendations?videoId= (same category/tags/channel, seeded
 * by watch history when signed in), topped up from the general feed when the
 * API returns too few. When every source comes back empty it retries once,
 * then falls through the last-resort sources.
 *
 * An empty shelf is either an answer (the sources were reached and found
 * nothing: a channel's only video, a new site) or a failure (no source could
 * be reached). Only the failure is an error the viewer can retry (#1552).
 */
import type { VideoInfo, VideoObject } from '@/interfaces';

/** Videos the shelf aims to show. */
export const RELATED_LIMIT = 15;
/** Wait before the single retry of an empty shelf. */
export const RELATED_RETRY_DELAY_MS = 500;
/** sessionStorage key of the most recent non-empty shelf. */
export const LAST_GOOD_SHELF_KEY = 'related:last-good-shelf';

type ApiVideo = Partial<VideoObject> & {
  id: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  playUrl?: string;
};

/** API video (list or recommendation shape) to the card model used by the related shelf. */
export function toVideoInfo(video: ApiVideo): VideoInfo {
  const created = video.dateCreated ?? (video as { createdAt?: string }).createdAt;
  const modified = video.dateModified ?? (video as { updatedAt?: string }).updatedAt ?? created;
  return {
    id: video.id,
    title: video.title ?? '',
    // The title and channel name in every language: an Arabic page shows Arabic ones (Up next showed English)
    ...(video.titleLocalized ? { titleLocalized: video.titleLocalized } : {}),
    description: video.description ?? null,
    channel: (video as { channel?: string }).channel ?? '',
    channelId: video.channelId ?? null,
    channelName: video.channelName ?? '',
    ...(video.channelNameLocalized ? { channelNameLocalized: video.channelNameLocalized } : {}),
    thumbnail: video.thumbnailUrl ?? '',
    video: video.videoUrl ?? video.playUrl ?? '',
    views: `${video.views || 0}`,
    width: video.width,
    height: video.height,
    availableResolutions: video.availableResolutions,
    dateCreated: new Date(created ?? 0),
    dateModified: new Date(modified ?? 0),
    likesCount: video.likesCount ?? 0,
    dislikesCount: video.dislikesCount ?? 0,
    commentsCount: video.commentsCount ?? 0,
    ...(typeof video.duration === 'number' ? { duration: video.duration } : {}),
    ...(typeof (video as { isShort?: unknown }).isShort === 'boolean' ? { isShort: (video as { isShort: boolean }).isShort } : {}),
    ...((video as { seriesNext?: unknown }).seriesNext === true ? { seriesNext: true } : {}),
  };
}

/**
 * Recommendations first, then feed videos not already listed, never the
 * current video, at most `limit` entries.
 */
export function mergeRelated(
  currentVideoId: string,
  recommended: VideoInfo[],
  feed: VideoInfo[],
  limit: number = RELATED_LIMIT,
): VideoInfo[] {
  const seen = new Set<string>([currentVideoId]);
  const out: VideoInfo[] = [];
  for (const video of [...recommended, ...feed]) {
    if (!video?.id || seen.has(video.id)) continue;
    seen.add(video.id);
    out.push(video);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One source of the shelf. An array, even an empty one, is an answer; `undefined` or a throw
 * means the source could not be reached (the API helpers resolve `undefined` on a failed request).
 */
type RelatedSource = () => Promise<VideoInfo[] | undefined>;

/** Every related source failed: nothing answered, so the empty shelf is not an answer. */
export class RelatedUnavailableError extends Error {
  constructor() {
    super('No related source answered');
    this.name = 'RelatedUnavailableError';
  }
}

/** The source's videos, or null when it could not answer. */
async function read(source: RelatedSource): Promise<VideoInfo[] | null> {
  try {
    return (await source()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Recommendations alone when they fill the shelf, otherwise topped up from the
 * feed, which is only requested in that case. `answered` is whether any source
 * it asked gave an answer.
 */
async function buildShelf(
  currentVideoId: string,
  sources: { recommended: RelatedSource; feed: RelatedSource },
  limit: number,
): Promise<{ shelf: VideoInfo[]; answered: boolean }> {
  const recommended = await read(sources.recommended);
  const shelf = mergeRelated(currentVideoId, recommended ?? [], [], limit);
  if (shelf.length >= limit) return { shelf, answered: true };
  const feed = await read(sources.feed);
  return { shelf: mergeRelated(currentVideoId, recommended ?? [], feed ?? [], limit), answered: recommended !== null || feed !== null };
}

/**
 * Build the shelf, retrying once when it comes back empty (a failed request
 * and a quiet moment look alike to a single try). `lastResort` sources are
 * tried in order only after that retry.
 *
 * Resolves the shelf, empty when the sources answered with nothing to show.
 * Rejects with RelatedUnavailableError when the shelf is empty and no source
 * answered at all, so the page can tell a failure from an empty answer.
 */
export async function loadRelated(
  currentVideoId: string,
  sources: {
    recommended: RelatedSource;
    feed: RelatedSource;
    lastResort?: RelatedSource[];
  },
  limit: number = RELATED_LIMIT,
  retryDelayMs: number = RELATED_RETRY_DELAY_MS,
): Promise<VideoInfo[]> {
  const first = await buildShelf(currentVideoId, sources, limit);
  if (first.shelf.length > 0) return first.shelf;

  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  const second = await buildShelf(currentVideoId, sources, limit);
  let shelf = second.shelf;
  let answered = first.answered || second.answered;

  for (const source of sources.lastResort ?? []) {
    if (shelf.length > 0) break;
    const videos = await read(source);
    if (videos !== null) answered = true;
    shelf = mergeRelated(currentVideoId, videos ?? [], [], limit);
  }
  if (shelf.length === 0 && !answered) throw new RelatedUnavailableError();
  return shelf;
}

/** Remember a shelf for when every source is down. Storage may be unavailable. */
export function saveLastGoodShelf(shelf: VideoInfo[]): void {
  if (shelf.length === 0) return;
  try {
    sessionStorage.setItem(LAST_GOOD_SHELF_KEY, JSON.stringify(shelf));
  } catch {
    // Private mode, quota or server render: the shelf just isn't remembered.
  }
}

/** The remembered shelf with its dates restored; empty when there is none. */
export function readLastGoodShelf(): VideoInfo[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(LAST_GOOD_SHELF_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return (parsed as VideoInfo[])
      .filter((video) => typeof video?.id === 'string')
      .map((video) => ({
        ...video,
        dateCreated: new Date(video.dateCreated),
        dateModified: new Date(video.dateModified),
      }));
  } catch {
    return [];
  }
}
