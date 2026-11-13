import { shareImagePath } from '@/lib/embed/share-image';

/**
 * Server-rendered data never carries a signed media URL (wiki AUN-SEO phase 4, #1209). Bunny tokens
 * (and R2 /priv/ links) expire within hours, and the data a server page hands its client components is
 * in the HTML and the RSC payload. Thumbnails of videos anyone may watch become the stable same-origin
 * /thumb/<id>.jpg (it has width variants for a srcset); any other signed URL is dropped. When an image
 * the viewer would see was dropped (their own private video, say), the data is marked `partial` and
 * the client reloads it after hydration, getting freshly signed URLs from the API.
 */

/** A Bunny token (query or path form) or an R2 private link: anything that expires */
const SIGNED = /bcdn_token=|[?&]token=[^&]*&(?:amp;)?expires=|[?&]expires=\d+&(?:amp;)?token=|^https:\/\/media(?:\.[a-z]+)?\.alummahnow\.net\/priv\//i;

/** Keys that hold an image the page shows (a dropped one makes the data partial) */
const IMAGE_KEY = /(thumb|poster|image|preview|cover|avatar|banner)/i;

/** Upload states in which /thumb has nothing to serve (lib/embed/content.ts) */
const NOT_PLAYABLE = new Set(['initiated', 'uploading', 'processing', 'failed']);

export function isSignedMediaUrl(value: string): boolean {
  return SIGNED.test(value);
}

export interface StableVideoFields {
  id?: string;
  thumbnailUrl?: string | null;
  thumbnailSizes?: unknown;
  isPublic?: boolean;
  isUnlisted?: boolean;
  isDeleted?: boolean;
  isHidden?: boolean;
  uploadStatus?: string;
}

/** /thumb serves this video's image to anyone: public (or unlisted), not removed, playable */
export function hasStableThumb(video: StableVideoFields): boolean {
  if (!video.id) return false;
  if (video.isPublic === false && video.isUnlisted !== true) return false;
  if (video.isDeleted === true || video.isHidden === true) return false;
  return !(video.uploadStatus && NOT_PLAYABLE.has(video.uploadStatus));
}

export interface Stable<T> {
  value: T;
  /** An image the page shows was dropped: reload the data on the client */
  partial: boolean;
}

const looksLikeVideo = (node: Record<string, unknown>): boolean =>
  typeof node.id === 'string' && 'thumbnailUrl' in node && ('uploadStatus' in node || 'views' in node || 'duration' in node || 'channelId' in node) && !('videos' in node) && !('videoItems' in node);

/**
 * A copy of `data` safe to server-render: video thumbnails on /thumb, no signed URL anywhere.
 * Playlist covers taken from a video (`cover.videoId`) use that video's /thumb image.
 */
export function stableImages<T>(data: T): Stable<T> {
  let partial = false;
  const walk = (node: unknown, key: string): unknown => {
    if (typeof node === 'string') {
      if (!isSignedMediaUrl(node)) return node;
      if (IMAGE_KEY.test(key)) partial = true;
      return undefined;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, key));
    if (!node || typeof node !== 'object') return node;
    const source = node as Record<string, unknown>;
    // A video anyone may watch shows its /thumb image: its CDN thumbnail fields are replaced, not dropped
    const stableVideo = looksLikeVideo(source) && typeof source.thumbnailUrl === 'string' && !!source.thumbnailUrl && hasStableThumb(source as StableVideoFields);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
      if (stableVideo && (k === 'thumbnailUrl' || k === 'thumbnailSizes')) continue;
      // A cover taken from a video shows that video's /thumb image
      const cover = k === 'cover' ? (v as { videoId?: unknown; thumbnailUrl?: unknown } | null) : null;
      if (cover && typeof cover.videoId === 'string' && typeof cover.thumbnailUrl === 'string' && isSignedMediaUrl(cover.thumbnailUrl)) {
        out.cover = { ...cover, thumbnailUrl: shareImagePath(cover.videoId) };
        continue;
      }
      // thumbnailSizes.hd keeps its parent's image key; any other field is judged by its own name
      const next = walk(v, IMAGE_KEY.test(k) || !IMAGE_KEY.test(key) ? k : key);
      if (next !== undefined) out[k] = next;
    }
    // The srcset comes from /thumb's widths; per-size CDN URLs are not needed
    if (stableVideo) out.thumbnailUrl = shareImagePath(source.id as string);
    return out;
  };
  const value = walk(data, '') as T;
  return { value, partial };
}
