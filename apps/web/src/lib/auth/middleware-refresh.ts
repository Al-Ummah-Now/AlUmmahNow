/**
 * Token refresh for the middleware: every page render, RSC fetch and Server
 * Action passes through it, so this is where the active account's access token
 * is renewed shortly before it expires.
 *
 * The rotated cookie is written to the forwarded request (so this render's
 * cookies() already sees the new token) and returned for the caller to set on
 * the response (so the browser stores it). Never throws: on any problem the
 * request goes on with the cookie it came with.
 */

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './session-cookie';
import type { SessionData } from './session-manager';
import { applyKnownRotations, refreshAccountInSession, shouldRefresh, type RefreshOptions } from './token-refresh';

/** The new session cookie value when it changed, otherwise null. */
export async function refreshSessionCookie(request: NextRequest, options: RefreshOptions = {}): Promise<string | null> {
  try {
    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) return null;

    const data = JSON.parse(raw) as SessionData;
    if (!data?.accounts || typeof data.accounts !== 'object') return null;

    const now = (options.now ?? Date.now)();
    let changed = applyKnownRotations(data, now);

    const active = data.accounts[data.activeUserId];
    if (active && shouldRefresh(active, now)) {
      const result = await refreshAccountInSession(data, data.activeUserId, options);
      if (result === 'refreshed' || result === 'needs-sign-in') changed = true;
    }

    if (!changed) return null;

    const value = JSON.stringify(data);
    // Updates the request's Cookie header, which the forwarded request copies
    request.cookies.set(SESSION_COOKIE_NAME, value);
    return value;
  } catch {
    return null;
  }
}
