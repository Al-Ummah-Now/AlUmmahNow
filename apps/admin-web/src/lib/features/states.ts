import type { FeatureKey } from '@al-ummah/shared-types';
import { listFeatures, type FeatureItem } from '@/lib/api/features';
import { logger } from '@/lib/logger';

export type FeatureStates = Partial<Record<FeatureKey, Pick<FeatureItem, 'effective' | 'enabled'>>>;

/**
 * Each feature's state for the status lines on the pages that used to hold its switch. Never fails
 * the page: without an answer the lines just link to the Features page.
 */
export async function featureStates(): Promise<FeatureStates> {
  try {
    const items = await listFeatures();
    return Object.fromEntries(items.map((i) => [i.key, { effective: i.effective, enabled: i.enabled }]));
  } catch (error) {
    logger.warn('[features] Could not read the switches for a status line', { error: error instanceof Error ? error.message : String(error) });
    return {};
  }
}
