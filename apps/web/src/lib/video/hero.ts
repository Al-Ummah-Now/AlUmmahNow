/**
 * The large featured frame on the home page and the channel Spotlight
 * (2026-11-10: "feature video in home doesn't use correct aspect for video").
 *
 * The frame is always 16:9, the shape of a landscape video, on every
 * breakpoint. A landscape thumbnail fills it; a vertical or square one (a
 * Short) is shown whole over a blurred copy of itself, never cut down to a
 * centre strip.
 */
import { isShortOrFlag } from '@al-ummah/shared-types';
import { aspectOf, isPortrait, thumbnailFit, type ThumbnailFit } from './aspect';

export const HERO_ASPECT = 16 / 9;

/** Stored width-only thumbnail variants (aspect kept), as the API sends them. */
export interface HeroThumbnailSizes {
  hd?: string;
  sd?: string;
  mobile?: string;
}

/** Video fields the hero reads (both the web and the shared VideoObject have them). */
export interface HeroVideo {
  id: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  format?: unknown;
  isShort?: boolean;
  isLive?: boolean | null;
  /** Featured by an editor: wins the home hero whatever its shape */
  isFeatured?: boolean;
  uploadStatus?: string;
  isDraft?: boolean;
  isPublic?: boolean;
}

/** Vertical or square: a Short by the shared rule, or taller than wide by its stored size. */
export function isUprightVideo(video: HeroVideo): boolean {
  return isShortOrFlag(video) || isPortrait(video.width, video.height);
}

/**
 * How the thumbnail sits in the 16:9 hero frame. The loaded image's own shape
 * decides (it is what would be cropped); before it loads, the video's shape
 * does, so a Short is letterboxed from the first paint.
 */
export function heroThumbFit(video: HeroVideo, imageAspect?: number): ThumbnailFit {
  if (imageAspect !== undefined) return thumbnailFit(imageAspect, undefined, HERO_ASPECT);
  if (isUprightVideo(video)) return 'contain';
  return thumbnailFit(undefined, aspectOf(video.width, video.height), HERO_ASPECT);
}

/** Ready to watch and public: uploads still processing, drafts and private videos are never featured. */
export function isFeaturable(video: HeroVideo): boolean {
  const ready = video.uploadStatus === undefined || video.uploadStatus === 'ready';
  return ready && !video.isDraft && video.isPublic !== false;
}

/**
 * The home hero's video, from the newest-first list: a video an editor
 * featured (`isFeatured`), whatever its shape; else the newest ready landscape
 * video; else the newest ready video of any shape (a Short, letterboxed).
 */
export function pickHomeFeatured<T extends HeroVideo>(videos: T[], exclude: ReadonlySet<string> = new Set()): T | undefined {
  const candidates = videos.filter((v) => !exclude.has(v.id) && isFeaturable(v));
  return (
    candidates.find((v) => v.isFeatured === true) ??
    candidates.find((v) => !isUprightVideo(v)) ??
    candidates[0]
  );
}

/** `srcset` from the stored width-only variants (aspect kept), or undefined when there are none. */
export function heroSrcSet(sizes: HeroThumbnailSizes | undefined): string | undefined {
  if (!sizes) return undefined;
  const entries = [
    [sizes.mobile, 320],
    [sizes.sd, 640],
    [sizes.hd, 1280],
  ] as const;
  const parts = entries.filter(([url]) => typeof url === 'string' && url.length > 0).map(([url, w]) => `${url} ${w}w`);
  return parts.length ? parts.join(', ') : undefined;
}
