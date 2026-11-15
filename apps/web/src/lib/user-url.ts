/**
 * Public profile URLs (Story 29.5).
 *
 * Canonical: /{locale}/u/@{handle}, served by the /{locale}/u/{handle} route through a middleware
 * rewrite (App Router folders starting with `@` are parallel-route slots, as for channel @handles
 * in channel-url.ts). /{locale}/u/{handle} opened directly 301s to the @ form.
 */

const AT_PATH = /^\/([a-z]{2})\/u\/(?:@|%40)([A-Za-z0-9._-]{1,40})\/?$/;
const PLAIN_PATH = /^\/([a-z]{2})\/u\/([A-Za-z0-9._-]{1,40})\/?$/;

export function userProfileRewritePath(pathname: string): { locale: string; handle: string; path: string } | null {
  const match = pathname.match(AT_PATH);
  if (!match) return null;
  return { locale: match[1], handle: match[2], path: `/${match[1]}/u/${match[2]}` };
}

/** /{locale}/u/{handle} opened directly: the canonical form is /{locale}/u/@{handle} */
export function legacyUserProfilePath(pathname: string): string | null {
  const match = pathname.match(PLAIN_PATH);
  return match ? `/${match[1]}/u/@${match[2]}` : null;
}

/** Public URL of a user's profile */
export function userProfilePath(locale: string, handle: string): string {
  return `/${locale}/u/@${handle.replace(/^@+/, '')}`;
}
