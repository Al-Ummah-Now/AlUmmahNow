/** Server pages: why videos failed, by id. Never throws: without it the page shows what it knows itself. */
import type { VideoFailure } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';
import { getVideoFailures } from './admin';

export async function videoFailuresById(ids: string[]): Promise<Record<string, VideoFailure>> {
  try {
    const result = await getVideoFailures(ids);
    if (result.ok) return Object.fromEntries(result.data.items.map((f) => [f.videoId, f]));
    logger.warn('[failures] Not available', { status: result.status });
  } catch (error) {
    logger.warn('[failures] Not available', { error: error instanceof Error ? error.message : String(error) });
  }
  return {};
}
