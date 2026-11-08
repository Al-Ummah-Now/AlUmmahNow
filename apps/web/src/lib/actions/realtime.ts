/**
 * Server action that hands the browser its OpenAuth access token for the
 * realtime (WebSocket) server.
 *
 * The access token lives in httpOnly cookies, so client code cannot read it.
 * The websocket server verifies the token's ES256 signature against the auth
 * server's JWKS and takes the user id only from the token, so the browser must
 * send the real token. Tokens about to expire are refreshed first so reconnects succeed.
 */

'use server';

import { cookies as getCookies } from 'next/headers';
import { SessionManager } from '../auth/session-manager';
import { logger } from '@/lib/logger-server';

export async function getRealtimeAccessToken(): Promise<string | null> {
  try {
    const session = await SessionManager.getActiveSession();
    if (session) {
      // Refreshes (and saves) the token when it expires soon; null when the
      // sign-in has ended, so a dead token is never handed out
      return await SessionManager.getValidAccessToken(session.userId);
    }

    // Legacy single-account cookies
    const cookies = await getCookies();
    return cookies.get('access_token')?.value ?? null;
  } catch (error) {
    logger.error('[getRealtimeAccessToken] Failed to read access token', error);
    return null;
  }
}
