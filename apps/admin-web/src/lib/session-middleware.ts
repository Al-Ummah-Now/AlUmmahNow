/**
 * Keeps the admin session alive across short-lived access tokens.
 *
 * Server components cannot write cookies, so a refresh done during a render
 * (getAdminSession) is never persisted: the browser keeps re-sending the old,
 * already-rotated refresh token, which the issuer stops accepting 60 s later,
 * and the admin lands on /login. Middleware can write cookies, so it
 * refreshes the token shortly *before* it expires and sets the rotated pair
 * both on the forwarded request (so this render sees it) and on the response
 * (so the browser keeps it).
 *
 * The token's `exp` is read without verifying the signature: it only decides
 * *when* to refresh. Trust still comes from getAdminSession, which verifies
 * every token against the auth server's keys.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
  SESSION_COOKIE_NAME,
  parseSessionCookie,
  sessionCookieOptions,
  withRotatedTokens,
  type SessionTokens,
} from './session-cookie';
import { REFRESH_SKEW_SECONDS, refreshTokens, shouldRefresh } from './token-refresh';

const LOG_PREFIX = '[admin-web:session-refresh]';

export interface SessionMiddlewareDeps {
  issuer: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  log?: Pick<Console, 'info' | 'warn'>;
}

function readTokens(request: NextRequest): { tokens: SessionTokens; cookie?: string } | null {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    const tokens = parseSessionCookie(cookie);
    return tokens ? { tokens, cookie } : null;
  }
  const accessToken = request.cookies.get(LEGACY_ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(LEGACY_REFRESH_COOKIE)?.value;
  return accessToken && refreshToken ? { tokens: { accessToken, refreshToken } } : null;
}

export async function refreshSessionMiddleware(
  request: NextRequest,
  deps: SessionMiddlewareDeps,
): Promise<NextResponse> {
  const log = deps.log ?? console;
  const found = readTokens(request);
  if (!found || !deps.issuer) {
    // No session (the page redirects to /login) or misconfigured: nothing to do.
    return NextResponse.next();
  }

  const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000);
  if (!shouldRefresh(found.tokens.accessToken, nowSeconds, REFRESH_SKEW_SECONDS)) {
    return NextResponse.next();
  }

  const result = await refreshTokens(deps.issuer, found.tokens.refreshToken, deps.fetch ?? fetch);

  if (result.kind === 'refreshed') {
    const value = withRotatedTokens(found.cookie, result.tokens);
    // Forward the new cookie to this request's render...
    request.cookies.set(SESSION_COOKIE_NAME, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    // ...and hand it to the browser.
    response.cookies.set(SESSION_COOKIE_NAME, value, sessionCookieOptions());
    if (!found.cookie) {
      // Migrated from the legacy pair into admin_session.
      response.cookies.delete(LEGACY_ACCESS_COOKIE);
      response.cookies.delete(LEGACY_REFRESH_COOKIE);
    }
    log.info(`${LOG_PREFIX} access token refreshed`, { path: request.nextUrl.pathname });
    return response;
  }

  if (result.kind === 'invalid_grant') {
    // The refresh token is dead for good: sign in again. /login is outside
    // the middleware matcher and the cookie is gone, so this cannot loop.
    log.warn(`${LOG_PREFIX} refresh token rejected, signing out`, {
      path: request.nextUrl.pathname,
      description: result.description,
    });
    const response = NextResponse.redirect(new URL('/login', request.url), 303);
    response.cookies.delete(SESSION_COOKIE_NAME);
    response.cookies.delete(LEGACY_ACCESS_COOKIE);
    response.cookies.delete(LEGACY_REFRESH_COOKIE);
    return response;
  }

  // Transient failure: keep the session untouched. If the access token is
  // still valid the page works and the next request retries; if it already
  // expired, getAdminSession makes its own attempt.
  log.warn(`${LOG_PREFIX} refresh failed transiently, keeping session`, {
    path: request.nextUrl.pathname,
    reason: result.reason,
  });
  return NextResponse.next();
}
