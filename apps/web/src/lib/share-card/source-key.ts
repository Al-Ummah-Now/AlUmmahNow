/**
 * The part of an image URL that names the picture, without its signature: Bunny signs every API
 * answer afresh (`?token=&expires=`, or a path-form `/bcdn_token=.../` directory token), so the
 * stored share card is keyed by the URL with those removed. A new thumbnail is a new URL, so it
 * makes a new card.
 */
const SIGNING_PARAMS = ['token', 'expires', 'bcdn_token', 'token_path', 'token_countries', 'token_countries_blocked', 'limit'];

export function stableSourceKey(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    for (const p of SIGNING_PARAMS) parsed.searchParams.delete(p);
    parsed.pathname = parsed.pathname.replace(/^\/bcdn_token=[^/]*/, '');
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}
