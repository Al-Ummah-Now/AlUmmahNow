/**
 * Name and options of the session cookie (all signed-in accounts' tokens).
 *
 * Kept free of `next/headers` so the middleware (which writes the cookie when
 * it refreshes tokens) and SessionManager share exactly the same settings.
 */

export const SESSION_COOKIE_NAME = 'al_ummah_session';

/** 30 days in seconds. The refresh token inside lives longer; see token-refresh.ts. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  };
}
