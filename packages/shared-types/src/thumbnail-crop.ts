/**
 * Crop math for custom thumbnails: a thumbnail always has the video's shape
 * (owner, 2026-11-10: "don't let it happen in future"). The image is cropped,
 * never stretched: the crop keeps the target aspect, zoom narrows it, pan
 * moves it inside the image. The API refuses any other shape (422
 * thumbnail_shape, api-videos lib/thumbnail/shape.ts). Used by the web
 * studio and admin-web.
 */

export interface ThumbnailCropSize {
  width: number;
  height: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Same tolerance as the API (5%): odd encodes like 1280x696 count as 16:9. */
export const SHAPE_TOLERANCE = 0.05;
export const MAX_ZOOM = 4;
/** Longest edge of the cropped image (the frame picker uses the same). */
export const CROP_MAX_EDGE = 1280;

export function shapesMatch(a: ThumbnailCropSize, b: ThumbnailCropSize, tolerance = SHAPE_TOLERANCE): boolean {
  if (!(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0)) return true;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.max(ra, rb) / Math.min(ra, rb) <= 1 + tolerance;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The part of an image (imgW x imgH) shown in a frame of `aspect` (w/h).
 * zoom 1 = the largest crop of that aspect; pan -1..1 on each axis moves it
 * from one edge of the image to the other (0 = centred).
 */
export function cropRect(image: ThumbnailCropSize, aspect: number, zoom = 1, panX = 0, panY = 0): CropRect {
  const z = clamp(zoom, 1, MAX_ZOOM);
  let sw = image.width;
  let sh = sw / aspect;
  if (sh > image.height) {
    sh = image.height;
    sw = sh * aspect;
  }
  sw /= z;
  sh /= z;
  const slackX = image.width - sw;
  const slackY = image.height - sh;
  return {
    sx: (slackX / 2) * (1 + clamp(panX, -1, 1)),
    sy: (slackY / 2) * (1 + clamp(panY, -1, 1)),
    sw,
    sh,
  };
}

/** Pan change for a drag of (dx, dy) screen pixels over a frame `frameWidth` wide. */
export function panDelta(image: ThumbnailCropSize, aspect: number, zoom: number, frameWidth: number, dx: number, dy: number): { x: number; y: number } {
  const rect = cropRect(image, aspect, zoom);
  const scale = rect.sw / Math.max(1, frameWidth); // image px per screen px
  const slackX = image.width - rect.sw;
  const slackY = image.height - rect.sh;
  // Dragging the picture right shows more of its left side: pan moves the other way
  return {
    x: slackX > 0 ? (-dx * scale) / (slackX / 2) : 0,
    y: slackY > 0 ? (-dy * scale) / (slackY / 2) : 0,
  };
}

/** Output size: the target aspect with the longest edge CROP_MAX_EDGE. */
export function cropOutputSize(aspect: number, maxEdge = CROP_MAX_EDGE): ThumbnailCropSize {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return { width: maxEdge, height: Math.round(maxEdge * 9 / 16) };
  return aspect >= 1
    ? { width: maxEdge, height: Math.max(1, Math.round(maxEdge / aspect)) }
    : { width: Math.max(1, Math.round(maxEdge * aspect)), height: maxEdge };
}

/** "16:9", "9:16", "1:1", "4:3", or the rounded ratio for anything else. */
export function aspectLabel(size: ThumbnailCropSize): string {
  const r = size.width / size.height;
  const known: Array<[number, string]> = [[16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4']];
  const hit = known.find(([k]) => Math.abs(r / k - 1) <= SHAPE_TOLERANCE);
  return hit ? hit[1] : `${size.width}×${size.height}`;
}
