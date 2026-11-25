import { type NextRequest, NextResponse } from 'next/server';
import { DEFAULT_RETURN_PATH, loginPath, safeReturnPath } from './login-flow';
import { dropSession, readSession, storeSession } from './session-cookie';
import type { VerifiedRefresh } from './verified-refresh';

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
export async function handleRefresh(request: NextRequest, refresh: (issuer: string, refreshToken: string) => Promise<VerifiedRefresh>): Promise<NextResponse> {
  const next = safeReturnPath(request.nextUrl.searchParams.get('next')) ?? DEFAULT_RETURN_PATH;
  const found = readSession(request.cookies);

  /** Without the session */
  const signedOut = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url), 303);
    dropSession(response.cookies);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const issuer = process.env.Issuer;
  if (!found || !issuer) return signedOut(loginPath(next));

  const result = await refresh(issuer, found.tokens.refreshToken);
  // The account lost its roles: the same answer as signing in with it
  if (result.kind === 'no_access') return signedOut('/access-denied');
  // Dead token or the auth server is unreachable: /login signs a live
  // browser session back in silently (no loop: it is not a protected page)
  if (result.kind !== 'refreshed') return signedOut(loginPath(next));

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  storeSession(response.cookies, found, result.tokens, request.headers.get('host'));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
