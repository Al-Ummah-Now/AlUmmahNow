/**
 * Whether channel moves (the channelMove switch) are off for this request, checked before anything
 * else on their pages: while they are off there is nothing to sign in for either. Signed in, it is the
 * account's features; signed out there are none, so the switch is read from the gate itself: the API
 * asks a visitor to sign in only while it is on. Unknown counts as off.
 */
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { getFeatures } from '@/lib/features/server';
import { logger } from '@/lib/logger';

export async function channelMovesOff(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (await getServerAuthContext()) return !(await getFeatures()).channelMove;
  try {
    return (await fetchImpl(buildApiUrl('/api/move-offers'), { cache: 'no-store' })).status !== 401;
  } catch (error) {
    logger.warn('[ChannelMoves] Switch unreadable for a visitor', { error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}
