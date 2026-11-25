/**
 * The `admin_session` cookie: format, options and parsing.
 *
 * Edge-safe (no next/headers, no Node APIs) so both the middleware and the
 * server-side session helpers in ./auth share one definition.
 *
 * Format (unchanged): JSON `{ user, accessToken, refreshToken }`. Only the two
 * tokens are trusted; the user identity always comes from the verified token.
 */

export const SESSION_COOKIE_NAME = 'admin_session';
/** Pre-`admin_session` cookies, still read so old sign-ins keep working. */
export const LEGACY_ACCESS_COOKIE = 'access_token';
export const LEGACY_REFRESH_COOKIE = 'refresh_token';

/**
 * Cookie lifetime. Every token refresh re-sets the cookie, so an admin who
 * uses the app at least once a week stays signed in; the refresh token
 * itself lives much longer (about a year).
 */
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * The session cookie's options. Secure in production builds, except when the app is served over
 * plain http on localhost (the local E2E stack), the same rule /api/auth/start applies to its state
 * cookie: WebKit and Firefox drop a Secure cookie set over http://localhost, so the session never
 * stuck there. Deployed hosts are https, so they keep Secure.
 */
export function sessionCookieOptions(host?: string | null) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && !(host ?? '').includes('localhost'),
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  };
}

function parseCookieObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseSessionCookie(value: string): SessionTokens | null {
  const parsed = parseCookieObject(value);
  if (typeof parsed?.accessToken !== 'string' || typeof parsed?.refreshToken !== 'string') {
    return null;
  }
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** The session a request carries: the cookie's tokens, or the legacy pair (no `cookie`). */
export function readSession(cookies: CookieReader): { tokens: SessionTokens; cookie?: string } | null {
  const cookie = cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    const tokens = parseSessionCookie(cookie);
    return tokens ? { tokens, cookie } : null;
  }
  const accessToken = cookies.get(LEGACY_ACCESS_COOKIE)?.value;
  const refreshToken = cookies.get(LEGACY_REFRESH_COOKIE)?.value;
  return accessToken && refreshToken ? { tokens: { accessToken, refreshToken } } : null;
}

interface CookieWriter {
  set(name: string, value: string, options: ReturnType<typeof sessionCookieOptions>): unknown;
  delete(name: string): unknown;
}

/** Stores a refreshed session in a response (moving a legacy pair to `admin_session`); returns the cookie's value. */
export function storeSession(cookies: CookieWriter, found: { cookie?: string }, tokens: SessionTokens, host: string | null): string {
  const value = withRotatedTokens(found.cookie, tokens);
  cookies.set(SESSION_COOKIE_NAME, value, sessionCookieOptions(host));
  if (!found.cookie) {
    cookies.delete(LEGACY_ACCESS_COOKIE);
    cookies.delete(LEGACY_REFRESH_COOKIE);
  }
  return value;
}

/** Deletes every cookie that can carry a session from a response. */
export function dropSession(cookies: Pick<CookieWriter, 'delete'>): void {
  for (const name of [SESSION_COOKIE_NAME, LEGACY_ACCESS_COOKIE, LEGACY_REFRESH_COOKIE]) cookies.delete(name);
}

/**
 * The cookie value with its tokens replaced by `tokens`, keeping every other
 * field (e.g. `user`) of `previous` so the format stays exactly the same.
 */
export function withRotatedTokens(previous: string | undefined, tokens: SessionTokens): string {
  const base = (previous && parseCookieObject(previous)) || {};
  return JSON.stringify({ ...base, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}
