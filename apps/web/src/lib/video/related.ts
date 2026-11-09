/**
 * Watch page "related" shelf (Epic 7.3): videos similar to the one playing,
 * from GET /api/recommendations?videoId= (same category/tags/channel, seeded
 * by watch history when signed in), topped up from the general feed when the
 * API returns too few. When every source comes back empty it retries once,
 * then falls through the last-resort sources.
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
    titleLocalized: (video as { titleLocalized?: Record<string, string> }).titleLocalized,
    description: video.description ?? null,
    channel: (video as { channel?: string }).channel ?? '',
    channelId: video.channelId ?? null,
    channelName: video.channelName ?? '',
    thumbnail: video.thumbnailUrl ?? '',
    duration: (video as { duration?: number }).duration,
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

type RelatedSource = () => Promise<VideoInfo[] | undefined>;

/** A source that fails counts as empty. */
async function read(source: RelatedSource): Promise<VideoInfo[]> {
  try {
    return (await source()) ?? [];
  } catch {
    return [];
  }
}

/**
 * Recommendations alone when they fill the shelf, otherwise topped up from the
 * feed, which is only requested in that case.
 */
async function buildShelf(
  currentVideoId: string,
  sources: { recommended: RelatedSource; feed: RelatedSource },
  limit: number,
): Promise<VideoInfo[]> {
  const recommended = await read(sources.recommended);
  const shelf = mergeRelated(currentVideoId, recommended, [], limit);
  if (shelf.length >= limit) return shelf;
  return mergeRelated(currentVideoId, recommended, await read(sources.feed), limit);
}

/**
 * Build the shelf, retrying once when it comes back empty. The API helpers
 * report failures as empty results, so an empty shelf is the retry signal.
 * `lastResort` sources are tried in order only after that retry.
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
  let shelf = await buildShelf(currentVideoId, sources, limit);
  if (shelf.length > 0) return shelf;

  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  shelf = await buildShelf(currentVideoId, sources, limit);

  for (const source of sources.lastResort ?? []) {
    if (shelf.length > 0) break;
    shelf = mergeRelated(currentVideoId, await read(source), [], limit);
  }
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
