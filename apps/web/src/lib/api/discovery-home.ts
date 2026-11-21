'use server';

/**
 * The home page's ranked rails (GET /api/discovery/home, wiki E07 "Discovery ranking"); the shapes
 * and helpers are in lib/discovery/home-rails.ts.
 */
import { buildApiUrl } from './api-client';
import { logger } from '@/lib/logger-server';
import { HOME_RAIL_LIMIT, parseHomeRails, type HomeRail } from '@/lib/discovery/home-rails';

/** The home rails for a viewer language (its videos rank higher), or null when the API failed. */
export async function getHomeRails(language: 'en' | 'ar'): Promise<HomeRail[] | null> {
  try {
    const response = await fetch(buildApiUrl(`/api/discovery/home?language=${language}&limit=${HOME_RAIL_LIMIT}`), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      logger.warn('[getHomeRails] API error', { status: response.status });
      return null;
    }
    return parseHomeRails(await response.json());
  } catch (error) {
    logger.error('[getHomeRails] Request failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
