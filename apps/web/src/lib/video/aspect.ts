/**
 * Thumbnail aspect handling (2026-11-10: "single video upload, thumbs dont
 * match aspect"). A thumbnail whose shape is close to its box's fills the box
 * (a sliver of a 1.9:1 image in a 16:9 box is cropped, as everywhere). One
 * whose shape is clearly different (a vertical, square or 4:3 thumbnail in a
 * 16:9 card, a landscape one in a 9:16 shorts box) is shown whole
 * (object-contain) over a blurred copy of itself: never stretched and never
 * cut down to a centre strip.
 */

export type ThumbnailFit = 'cover' | 'contain';

/** Thumbnail boxes are 16:9 unless measured otherwise. */
export const DEFAULT_BOX_ASPECT = 16 / 9;
/**
 * An image narrower than its box by more than this factor is shown whole:
 * in a 16:9 card that is 3:2 (1.5), 4:3, square and vertical, while 16:10
 * (1.6) still fills it.
 */
export const NARROWER_TOLERANCE = 1.15;
/**
 * An image wider than its box keeps filling it (sides cropped, as cards always
 * did: a 16:9 thumbnail in a ~1.45:1 card) unless it is this much wider, e.g. a
 * landscape thumbnail in a 9:16 shorts box.
 */
export const WIDER_TOLERANCE = 1.4;

/** width / height, or undefined when either is missing or not positive. */
export function aspectOf(width?: number | null, height?: number | null): number | undefined {
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return width / height;
}

/**
 * How a thumbnail sits in its box. The image's own size decides once it has
 * loaded (it is what would be cropped); until then the video's stored size
 * (Bunny's width/height) is the hint, so a short renders letterboxed from the
 * first paint.
 */
export function thumbnailFit(
  imageAspect?: number,
  videoAspect?: number,
  boxAspect: number = DEFAULT_BOX_ASPECT
): ThumbnailFit {
  const aspect = imageAspect ?? videoAspect;
  const box = boxAspect > 0 && Number.isFinite(boxAspect) ? boxAspect : DEFAULT_BOX_ASPECT;
  if (aspect === undefined) return 'cover';
  const ratio = aspect / box;
  return ratio < 1 / NARROWER_TOLERANCE || ratio > WIDER_TOLERANCE ? 'contain' : 'cover';
}

/** Height >= width: a vertical (or square) video. */
export function isPortrait(width?: number | null, height?: number | null): boolean {
  const aspect = aspectOf(width, height);
  return aspect !== undefined && aspect <= 1;
}
