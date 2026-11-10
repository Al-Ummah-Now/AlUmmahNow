'use client';

/**
 * The live channel list for the account menu and the channel switcher:
 * GET /api/channels/access, called straight from the browser (no Server
 * Action, which would queue behind the page's own actions). The session
 * cookie only holds a small first-paint cache.
 */

import type { AccessibleChannel } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { reportChannelListFailure } from './report';

export class ChannelAccessError extends Error {
  constructor(readonly reason: 'signed-out' | 'http' | 'network' | 'account-mismatch', readonly status?: number) {
    super(`Channel list unavailable (${reason}${status ? ` ${status}` : ''})`);
    this.name = 'ChannelAccessError';
  }
}

/**
 * Channels the signed-in account owns or holds a channel role on, each with
 * its role. `expectedUserId` guards against a token cached for another
 * account right after a switch. Throws ChannelAccessError (already reported).
 */
export async function fetchChannelAccess(expectedUserId: string, signal?: AbortSignal): Promise<AccessibleChannel[]> {
  let auth = await fetchClientAuthInfo();
  if (auth.userId && auth.userId !== expectedUserId) auth = await fetchClientAuthInfo(true);
  if (!auth.accessToken) throw report(new ChannelAccessError('signed-out'));
  if (auth.userId && auth.userId !== expectedUserId) throw report(new ChannelAccessError('account-mismatch'));

  let response: Response;
  try {
    // No channelId header: a channel whose role was just revoked would refuse the request
    response = await fetch(`${getApiUrl().replace(/\/$/, '')}/api/channels/access`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw report(new ChannelAccessError('network'));
  }
  if (response.status === 401) {
    // The token expired between the token call and this one: one retry with a fresh token
    const fresh = await fetchClientAuthInfo(true);
    if (fresh.accessToken && fresh.accessToken !== auth.accessToken && (!fresh.userId || fresh.userId === expectedUserId)) {
      response = await fetch(`${getApiUrl().replace(/\/$/, '')}/api/channels/access`, {
        headers: { Authorization: `Bearer ${fresh.accessToken}` },
        cache: 'no-store',
        signal,
      });
    }
  }
  if (!response.ok) throw report(new ChannelAccessError('http', response.status));
  const body = (await response.json().catch(() => null)) as { data?: AccessibleChannel[] } | null;
  if (!body || !Array.isArray(body.data)) throw report(new ChannelAccessError('http', response.status));
  return body.data;
}

function report(error: ChannelAccessError): ChannelAccessError {
  // Signed out is an answer, not a failure
  if (error.reason !== 'signed-out') reportChannelListFailure({ reason: error.reason, status: error.status });
  return error;
}
