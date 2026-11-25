/**
 * GET /api/realtime/token → { url, token, expiresAt }
 *
 * Hands the admin's access token to this tab's realtime socket
 * (lib/live/admin-live-client.ts, docs/admin/LIVE_OPS.md §B.5). Same-origin
 * only and never cached; the session cookie itself stays httpOnly. The middleware does not run for
 * /api routes: an access token that has expired, or is about to, is refreshed here (a route handler
 * can store the rotated pair), and the new one is checked like the old one.
 * The realtime worker checks the token's roles per admin topic.
 */
import type { NextRequest } from 'next/server';
import { getAdminSessionState, verifyAccessToken } from '@/lib/auth';
import { handleRealtimeToken } from '@/lib/live/realtime-token';
import { logger } from '@/lib/logger';
import { refreshVerified } from '@/lib/verified-refresh';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return handleRealtimeToken(request, {
    state: getAdminSessionState,
    issuer: process.env.Issuer,
    refresh: (issuer, refreshToken) => refreshVerified(issuer, refreshToken, { verify: verifyAccessToken }),
    log: logger,
  });
}
