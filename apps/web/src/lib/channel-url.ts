/**
 * Channel URL helpers (Story 29.1).
 *
 * Canonical channel URL: /{locale}/@{handle}. Channels without a handle (not
 * backfilled yet) keep /{locale}/channels/{id}, which always keeps working.
 */

/**
 * /{locale}/@{handle} is served by the /{locale}/c/{handle} route. App Router
 * folders starting with `@` are parallel-route slots, so the `@` form can
 * only be a middleware rewrite.
 */
const HANDLE_PATH = /^\/([a-z]{2})\/(?:@|%40)([A-Za-z0-9._-]{1,40})\/?$/;

export function handleRewritePath(pathname: string): { locale: string; handle: string; path: string } | null {
  const match = pathname.match(HANDLE_PATH);
  if (!match) return null;
  return { locale: match[1], handle: match[2], path: `/${match[1]}/c/${match[2]}` };
}

/** /{locale}/c/{handle} opened directly (not through the @ rewrite): the canonical form is /{locale}/@{handle} */
const C_PATH = /^\/([a-z]{2})\/c\/([A-Za-z0-9._-]{1,40})\/?$/;

export function legacyHandlePath(pathname: string): string | null {
  const match = pathname.match(C_PATH);
  return match ? `/${match[1]}/@${match[2]}` : null;
}

/** The query string of a page's searchParams, kept across a redirect ("" when empty) */
export function searchSuffix(query: Record<string, string | string[] | undefined> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Where a channel page request should go for good (wiki AUN-SEO: one URL per channel), or null to
 * render it: /channels/{id} of a channel with a handle, and an old @handle (handle history: the API
 * answered with the channel's current handle) both 301 to /{locale}/@{current handle}.
 */
export function channelRedirectTarget(
  locale: string,
  channel: { id: string; handle?: string | null },
  requestedHandle: string | null,
  query?: Record<string, string | string[] | undefined>,
): string | null {
  if (!channel.handle) return null;
  if (requestedHandle !== null && requestedHandle.toLowerCase() === channel.handle.toLowerCase()) return null;
  return `/${locale}/@${channel.handle}${searchSuffix(query)}`;
}

export interface ChannelUrlFields {
  id: string;
  handle?: string | null;
}

/** Public URL of a channel page. */
export function channelPath(locale: string, channel: ChannelUrlFields, tab?: string): string {
  const base = channel.handle ? `/${locale}/@${channel.handle}` : `/${locale}/channels/${channel.id}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

/** Display form of a handle: "@handle". */
export function formatHandle(handle?: string | null): string {
  return handle ? `@${handle}` : '';
}

/** Client-side mirror of the API rules (the API is authoritative). */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
const HANDLE_FORMAT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export type LocalHandleProblem = 'too_short' | 'too_long' | 'invalid_characters';

export function localHandleProblem(input: string): LocalHandleProblem | null {
  const handle = input.trim().replace(/^@+/, '');
  if (handle.length < HANDLE_MIN_LENGTH) return 'too_short';
  if (handle.length > HANDLE_MAX_LENGTH) return 'too_long';
  if (!HANDLE_FORMAT.test(handle)) return 'invalid_characters';
  return null;
}
