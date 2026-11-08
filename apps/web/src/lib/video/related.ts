/**
 * Watch page "related" shelf (Epic 7.3): videos similar to the one playing,
 * from GET /api/recommendations?videoId= (same category/tags/channel, seeded
 * by watch history when signed in), topped up from the general feed when the
 * API returns too few.
 */
import type { VideoInfo, VideoObject } from '@/interfaces';

/** Videos the shelf aims to show. */
export const RELATED_LIMIT = 15;

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
    description: video.description ?? null,
    channel: (video as { channel?: string }).channel ?? '',
    channelId: video.channelId ?? null,
    channelName: video.channelName ?? '',
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
