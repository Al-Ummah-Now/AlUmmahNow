import { type NextRequest, NextResponse } from 'next/server';
import {
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
  SESSION_COOKIE_NAME,
  parseSessionCookie,
  sessionCookieOptions,
  withRotatedTokens,
} from '@/lib/session-cookie';
import { refreshTokens } from '@/lib/token-refresh';
import { DEFAULT_RETURN_PATH, loginPath, safeReturnPath } from '@/lib/login-flow';

/**
 * GET /api/auth/refresh?next=/path
 *
 * The one place a render's expired session is refreshed (SCALABILITY-AUDIT
 * AW-1). A server component cannot write cookies, so a refresh made during a
 * render spent the refresh token without storing its successor: the browser
 * kept sending the spent token and the admin was signed out once the
 * issuer's 60 s reuse window closed. Renders now redirect here instead; this
 * route handler refreshes, stores the rotated pair and sends the browser back.
 *
 * Concurrent refreshes (page, prefetches, other tabs, other isolates) are
 * safe: the issuer hands out the same successor refresh token for every use
 * of a token within its reuse window.
 */
export async function GET(request: NextRequest) {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next')) ?? DEFAULT_RETURN_PATH;
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const tokens = cookie
    ? parseSessionCookie(cookie)
    : (() => {
        const accessToken = request.cookies.get(LEGACY_ACCESS_COOKIE)?.value;
        const refreshToken = request.cookies.get(LEGACY_REFRESH_COOKIE)?.value;
        return accessToken && refreshToken ? { accessToken, refreshToken } : null;
      })();

  const toLogin = () => {
    const response = NextResponse.redirect(new URL(loginPath(next), request.url), 303);
    response.cookies.delete(SESSION_COOKIE_NAME);
    response.cookies.delete(LEGACY_ACCESS_COOKIE);
    response.cookies.delete(LEGACY_REFRESH_COOKIE);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const issuer = process.env.Issuer;
  if (!tokens || !issuer) return toLogin();

  const result = await refreshTokens(issuer, tokens.refreshToken);
  if (result.kind !== 'refreshed') {
    // Dead token or the auth server is unreachable: /login signs a live
    // browser session back in silently (no loop: it is not a protected page)
    return toLogin();
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, withRotatedTokens(cookie, result.tokens), sessionCookieOptions(request.headers.get('host')));
  if (!cookie) {
    response.cookies.delete(LEGACY_ACCESS_COOKIE);
    response.cookies.delete(LEGACY_REFRESH_COOKIE);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
