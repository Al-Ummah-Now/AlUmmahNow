/** Smallest gap kept between the open menu and either side of the viewport. */
export const VIEWPORT_MARGIN = 8;

/**
 * Horizontal shift that brings a box spanning [left, right] inside a viewport
 * of the given width, VIEWPORT_MARGIN from each side (the menu's max width
 * already fits that space).
 */
export function menuShift(left: number, right: number, viewportWidth: number): number {
  if (left < VIEWPORT_MARGIN) return VIEWPORT_MARGIN - left;
  if (right > viewportWidth - VIEWPORT_MARGIN) return Math.max(VIEWPORT_MARGIN - left, viewportWidth - VIEWPORT_MARGIN - right);
  return 0;
}
