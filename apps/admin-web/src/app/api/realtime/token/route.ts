/**
 * GET /api/realtime/token → { url, token, expiresAt, ticketExpiresAt }
 *
 * Mints a single-use WebSocket ticket for this tab's realtime socket. This
 * same-origin route refreshes and verifies expiring sessions before minting
 * and can store the rotated httpOnly cookie. The worker checks roles per topic.
 */
import type { NextRequest } from 'next/server';
import { getAdminSessionState, verifyAccessToken } from '@/lib/auth';
import { mintAdminRealtimeTicket, realtimeUrlFor } from '@/lib/live/realtime-ticket';
import { handleRealtimeToken } from '@/lib/live/realtime-token';
import { logger } from '@/lib/logger';
import { refreshVerified } from '@/lib/verified-refresh';

export const dynamic = 'force-dynamic';

async function resolveInternalApiKey(): Promise<string> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const key = (env as { INTERNAL_API_KEY?: string | { get(): Promise<string> } }).INTERNAL_API_KEY;
    if (key) return typeof key === 'string' ? key : await key.get();
  } catch {
    // next dev / tests use process.env
  }
  return process.env.INTERNAL_API_KEY || '';
}

export function GET(request: NextRequest) {
  return handleRealtimeToken(request, {
    state: getAdminSessionState,
    issuer: process.env.Issuer,
    refresh: (issuer, refreshToken) => refreshVerified(issuer, refreshToken, { verify: verifyAccessToken }),
    mint: async (accessToken) => mintAdminRealtimeTicket(accessToken, {
      realtimeUrl: realtimeUrlFor({
        REALTIME_URL: process.env.REALTIME_URL,
        ADMIN_API_URL: process.env.ADMIN_API_URL,
      }),
      internalApiKey: await resolveInternalApiKey(),
    }),
    log: logger,
  });
}
