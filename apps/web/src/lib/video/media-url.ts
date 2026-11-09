/**
 * Whether two media URLs name the same resource. The player compares the source it was given with
 * the one it is playing to decide whether a new video needs loading; the browser reports the
 * playing one resolved against the page (absolute), while sources are often given relative, so a
 * plain string comparison read the same video as a new one and loaded it again (it did in Safari).
 */
export function isSameMediaUrl(a: string | null | undefined, b: string | null | undefined, base: string = typeof location === 'undefined' ? 'http://localhost/' : location.href): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return new URL(a, base).href === new URL(b, base).href;
  } catch {
    return false;
  }
}
