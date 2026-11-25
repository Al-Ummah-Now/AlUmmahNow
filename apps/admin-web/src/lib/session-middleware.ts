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
 * *when* to refresh. A refreshed token is verified before it is stored
 * (verified-refresh.ts), and getAdminSession verifies every token it uses.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, dropSession, readSession, storeSession, withRotatedTokens } from './session-cookie';
import { REFRESH_SKEW_SECONDS, shouldRefresh, unverifiedTokenRoles } from './token-refresh';
import { refreshVerified, type VerifyToken } from './verified-refresh';
import { highestAdminRole, isReviewOnly, reviewOnlyRedirect } from './roles';
import { PATH_HEADER, loginPath } from './login-flow';

const LOG_PREFIX = '[admin-web:session-refresh]';

export interface SessionMiddlewareDeps {
  issuer: string | undefined;
  fetch?: typeof fetch;
  verify: VerifyToken;
  now?: () => number;
  log?: Pick<Console, 'info' | 'warn'>;
}

export async function refreshSessionMiddleware(
  request: NextRequest,
  deps: SessionMiddlewareDeps,
): Promise<NextResponse> {
  const log = deps.log ?? console;
  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  // Server components cannot see the URL: hand them the path so a sign-in
  // redirect from a render can come back to it.
  request.headers.set(PATH_HEADER, path);
  const next = () => NextResponse.next({ request: { headers: request.headers } });

  const found = readSession(request.cookies);
  if (!found) {
    // No session: straight to sign-in (no "Please log in" page). /login sends
    // the browser to the auth server without a prompt, which signs its active
    // account in silently or shows the form. /login is outside the matcher.
    const status = request.method === 'GET' || request.method === 'HEAD' ? 307 : 303;
    return NextResponse.redirect(new URL(loginPath(path), request.url), status);
  }
  // Review-only accounts (VR7) stay in the review shell on every request, client-side navigations
  // included (the protected layout is not re-rendered between its pages). Routing only: the roles
  // are frozen at sign-in, so the refreshed token carries the same ones.
  if (isReviewOnly(highestAdminRole(unverifiedTokenRoles(found.tokens.accessToken)))) {
    const target = reviewOnlyRedirect(request.nextUrl.pathname);
    if (target) {
      const status = request.method === 'GET' || request.method === 'HEAD' ? 307 : 303;
      return NextResponse.redirect(new URL(target, request.url), status);
    }
  }
  if (!deps.issuer) {
    // Misconfigured: leave it to the page's own verification.
    return next();
  }

  const nowSeconds = Math.floor((deps.now ?? Date.now)() / 1000);
  if (!shouldRefresh(found.tokens.accessToken, nowSeconds, REFRESH_SKEW_SECONDS)) {
    return next();
  }

  const result = await refreshVerified(deps.issuer, found.tokens.refreshToken, { fetch: deps.fetch, verify: deps.verify });

  if (result.kind === 'refreshed') {
    // Forward the new cookie to this request's render...
    const value = withRotatedTokens(found.cookie, result.tokens);
    request.cookies.set(SESSION_COOKIE_NAME, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    // ...and hand it to the browser (a legacy pair moves into admin_session).
    storeSession(response.cookies, found, result.tokens, request.headers.get('host'));
    log.info(`${LOG_PREFIX} access token refreshed`, { path: request.nextUrl.pathname });
    return response;
  }

  if (result.kind === 'invalid_grant') {
    // The refresh token is dead for good: sign in again. /login asks the auth
    // server without a prompt, so a live browser session gets new tokens
    // silently and only a signed-out browser sees the form. /login is outside
    // the middleware matcher and the cookie is gone, so this cannot loop.
    log.warn(`${LOG_PREFIX} refresh token rejected, signing in again`, {
      path: request.nextUrl.pathname,
      description: result.description,
    });
    const response = NextResponse.redirect(new URL(loginPath(path), request.url), 303);
    dropSession(response.cookies);
    return response;
  }

  if (result.kind === 'no_access') {
    // The account lost its roles: the same answer as signing in with it
    log.warn(`${LOG_PREFIX} the refreshed session has no admin role`, { path: request.nextUrl.pathname });
    const response = NextResponse.redirect(new URL('/access-denied', request.url), 303);
    dropSession(response.cookies);
    return response;
  }

  // Transient failure: keep the session untouched. If the access token is
  // still valid the page works and the next request retries; if it already
  // expired, getAdminSession makes its own attempt.
  log.warn(`${LOG_PREFIX} refresh failed transiently, keeping session`, {
    path: request.nextUrl.pathname,
    reason: result.reason,
  });
  return next();
}
