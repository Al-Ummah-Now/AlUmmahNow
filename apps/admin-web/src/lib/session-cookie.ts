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

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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

/**
 * The cookie value with its tokens replaced by `tokens`, keeping every other
 * field (e.g. `user`) of `previous` so the format stays exactly the same.
 */
export function withRotatedTokens(previous: string | undefined, tokens: SessionTokens): string {
  const base = (previous && parseCookieObject(previous)) || {};
  return JSON.stringify({ ...base, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}
