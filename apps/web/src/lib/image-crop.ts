/**
 * Geometry for the avatar/cover crop dialog.
 *
 * The image is drawn centred in a fixed-aspect viewport, scaled by
 * `scale` (cover-fit scale x zoom) and shifted by `offset` (viewport px).
 * It must always cover the whole viewport, so offsets are clamped.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CropSpec {
  /** width / height of the crop frame */
  aspect: number;
  /** output image size in px */
  output: Size;
  /** show a round mask (avatars) instead of the full frame */
  round: boolean;
}

export const CROP_SPECS = {
  avatar: { aspect: 1, output: { width: 800, height: 800 }, round: true },
  // Channel and profile covers render full width at roughly 4:1 (object-cover).
  cover: { aspect: 4, output: { width: 2560, height: 640 }, round: false },
} as const satisfies Record<string, CropSpec>;

export type CropKind = keyof typeof CROP_SPECS;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Smallest scale at which the image still covers the viewport. */
export function coverScale(image: Size, viewport: Size): number {
  if (!image.width || !image.height) return 1;
  return Math.max(viewport.width / image.width, viewport.height / image.height);
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keep the scaled image covering the viewport. */
export function clampOffset(offset: Point, image: Size, viewport: Size, scale: number): Point {
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    x: noNegZero(Math.min(maxX, Math.max(-maxX, offset.x))),
    y: noNegZero(Math.min(maxY, Math.max(-maxY, offset.y))),
  };
}

/** Region of the source image (natural px) that is visible in the viewport. */
export function sourceRect(image: Size, viewport: Size, scale: number, offset: Point) {
  const left = (viewport.width - image.width * scale) / 2 + offset.x;
  const top = (viewport.height - image.height * scale) / 2 + offset.y;
  return {
    sx: noNegZero(-left / scale),
    sy: noNegZero(-top / scale),
    sw: viewport.width / scale,
    sh: viewport.height / scale,
  };
}

/** Avoid -0 (from negating/clamping 0) leaking into offsets and source rects. */
function noNegZero(n: number): number {
  return n === 0 ? 0 : n;
}
