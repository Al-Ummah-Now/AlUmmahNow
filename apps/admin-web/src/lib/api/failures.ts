/** Server pages: why videos failed, by id; null when it could not be read. Never throws. */
import type { VideoFailure } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';
import { getVideoFailures } from './admin';

export async function tryVideoFailures(ids: string[]): Promise<Record<string, VideoFailure> | null> {
  try {
    const result = await getVideoFailures(ids);
    if (result.ok) return Object.fromEntries(result.data.items.map((f) => [f.videoId, f]));
    logger.warn('[failures] Not available', { status: result.status });
  } catch (error) {
    logger.warn('[failures] Not available', { error: error instanceof Error ? error.message : String(error) });
  }
  return null;
}

/** The same, none when it could not be read: the page then shows what it knows itself. */
export const videoFailuresById = async (ids: string[]): Promise<Record<string, VideoFailure>> => (await tryVideoFailures(ids)) ?? {};
