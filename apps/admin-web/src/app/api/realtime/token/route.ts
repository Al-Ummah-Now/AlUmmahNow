/**
 * GET /api/realtime/token → { url, token, expiresAt }
 *
 * Hands the admin's access token to this tab's realtime socket
 * (lib/live/admin-live-client.ts, docs/admin/LIVE_OPS.md §B.5). Same-origin
 * only and never cached; the session cookie itself stays httpOnly. An expired
 * access token is refreshed here (a route handler can store the rotated pair).
 * The realtime worker checks the token's roles per admin topic.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getAdminSessionState } from '@/lib/auth';
import { hasAdminAccess } from '@/lib/roles';
import { SESSION_COOKIE_NAME, parseSessionCookie, sessionCookieOptions, withRotatedTokens } from '@/lib/session-cookie';
import { refreshTokens } from '@/lib/token-refresh';
import { realtimeUrlFor, tokenExpiry } from '@/lib/live/realtime-ticket';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function ticket(token: string) {
  return { url: realtimeUrlFor({ REALTIME_URL: process.env.REALTIME_URL, ADMIN_API_URL: process.env.ADMIN_API_URL }), token, expiresAt: tokenExpiry(token) ?? null };
}

export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

  const { session, expired } = await getAdminSessionState();
  if (session) {
    if (!hasAdminAccess(session.user.role)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
    return NextResponse.json(ticket(session.accessToken), { headers: NO_STORE });
  }
  if (!expired) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: NO_STORE });

  // Access token expired: refresh it here and store the rotated pair
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const tokens = cookie ? parseSessionCookie(cookie) : null;
  const issuer = process.env.Issuer;
  if (!tokens || !issuer) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: NO_STORE });
  const result = await refreshTokens(issuer, tokens.refreshToken);
  if (result.kind !== 'refreshed') {
    logger.debug('[realtime token] Refresh did not succeed', { kind: result.kind });
    return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: NO_STORE });
  }
  const response = NextResponse.json(ticket(result.tokens.accessToken), { headers: NO_STORE });
  response.cookies.set(SESSION_COOKIE_NAME, withRotatedTokens(cookie, result.tokens), sessionCookieOptions());
  return response;
}
