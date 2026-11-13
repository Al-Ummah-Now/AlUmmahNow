import type { ImageLoading } from './FitImage';

/** Cards at the top of a list that load at once: about the first row at phone and desktop widths */
export const LEADING_CARDS = 4;

/**
 * How the thumbnail of the card at `index` loads when its list leads the page: the first is the
 * page's largest image (its LCP element, high priority), the rest of the first row load at once,
 * every later card lazily as it nears the screen.
 */
export function leadingImageLoading(index: number, leading = true): ImageLoading | undefined {
  if (!leading || index >= LEADING_CARDS) return undefined;
  return index === 0 ? 'high' : 'eager';
}
