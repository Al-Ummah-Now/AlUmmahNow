/**
 * Server components and layouts: which features this request's account sees
 * (api-videos GET /api/me/features; shared-types features.ts). The same answer
 * the client hook useFeatures() reads, once per request and channel. Fails
 * closed: when it cannot be read, every feature is hidden.
 */
import { cache } from 'react';
import { NO_FEATURES, parseUserFeatures, type UserFeatures } from '@al-ummah/shared-types';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { buildApiUrl } from '@/lib/api/api-client';
import { logger } from '@/lib/logger';

export async function loadFeatures(channelId: string | null, fetchImpl: typeof fetch = fetch): Promise<UserFeatures> {
  const auth = await getServerAuthContext().catch(() => null);
  const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
  try {
    const res = await fetchImpl(buildApiUrl(`/api/me/features${query}`), {
      headers: auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {},
      cache: 'no-store',
    });
    if (res.ok) return parseUserFeatures(await res.json());
    logger.warn('[features] Unexpected answer', { status: res.status, channelId });
  } catch (error) {
    logger.warn('[features] Request failed', { channelId, error: error instanceof Error ? error.message : String(error) });
  }
  return NO_FEATURES;
}

/** Read once per request (React cache) for the account, optionally about one channel. */
export const getFeatures = cache((channelId?: string | null): Promise<UserFeatures> => loadFeatures(channelId ?? null));
