/**
 * Explore page data (Story 29.7): category counts, newest channels and
 * seasonal rails. Seasonal rails come from configuration in the
 * global_settings bucket (`explore/seasonal.json`), never from dates in code.
 */

import {
  ExploreCategory,
  SeasonalRail,
  SeasonalRailConfig,
  SearchChannelPayload,
  SearchDb,
  SearchVideoPayload,
  VIDEO_CATEGORIES,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { categoryCounts, searchIndex } from './query';

export const SEASONAL_CONFIG_KEY = 'explore/seasonal.json';
const MAX_SEASONAL_RAILS = 3;

function isValidRail(value: unknown): value is SeasonalRailConfig {
  const rail = value as SeasonalRailConfig;
  return !!rail && typeof rail.id === 'string' && !!rail.title?.en && !!rail.title?.ar &&
    Number.isFinite(new Date(rail.startsAt).getTime()) && Number.isFinite(new Date(rail.endsAt).getTime()) &&
    (typeof rail.category === 'string' || typeof rail.query === 'string');
}

/** Rails that are enabled and whose window contains `now`. */
export function activeSeasonalRails(configs: unknown, now: number): SeasonalRailConfig[] {
  const list = Array.isArray(configs) ? configs : Array.isArray((configs as { rails?: unknown[] })?.rails) ? (configs as { rails: unknown[] }).rails : [];
  return list
    .filter(isValidRail)
    .filter(rail => rail.enabled !== false && new Date(rail.startsAt).getTime() <= now && now < new Date(rail.endsAt).getTime())
    .slice(0, MAX_SEASONAL_RAILS);
}

export async function loadSeasonalConfig(bucket: R2Bucket | undefined): Promise<unknown> {
  if (!bucket) return [];
  try {
    const object = await bucket.get(SEASONAL_CONFIG_KEY);
    return object ? await object.json() : [];
  } catch (error) {
    logger.warn('[Explore] Unreadable seasonal config', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Explore tiles: only categories with at least one public, ready video in the
 * index (categoryCounts counts visible rows only), in the canonical order.
 * Never an empty tile; AI-suggested categories count like any other.
 */
export function nonEmptyCategories(counts: Map<string, number>): ExploreCategory[] {
  return VIDEO_CATEGORIES
    .map(category => ({ value: category.value, label: category.label, count: counts.get(category.value) ?? 0 }))
    .filter(category => category.count > 0);
}

export async function buildExplore(
  db: SearchDb,
  settings: R2Bucket | undefined,
  options: { language?: string; now?: number } = {},
): Promise<{ categories: ExploreCategory[]; newChannels: SearchChannelPayload[]; seasonal: SeasonalRail[] }> {
  const now = options.now ?? Date.now();
  const [counts, channels, seasonalConfig] = await Promise.all([
    categoryCounts(db, options.language),
    searchIndex(db, { type: 'channel', sort: 'date', limit: 12 }, { now }),
    loadSeasonalConfig(settings),
  ]);

  const categories = nonEmptyCategories(counts);

  const newChannels = channels.results
    .map(item => (item.type === 'channel' ? item.channel : null))
    .filter((c): c is SearchChannelPayload => !!c);

  const seasonal: SeasonalRail[] = [];
  for (const rail of activeSeasonalRails(seasonalConfig, now)) {
    const result = await searchIndex(db, {
      type: 'video',
      q: rail.query,
      category: rail.category,
      language: options.language,
      sort: rail.query ? 'relevance' : 'popular',
      limit: Math.min(Math.max(rail.limit ?? 12, 1), 24),
    }, { now });
    const videos = result.results
      .map(item => (item.type === 'video' ? item.video : null))
      .filter((v): v is SearchVideoPayload => !!v);
    seasonal.push({ id: rail.id, title: rail.title, subtitle: rail.subtitle, endsAt: rail.endsAt, videos });
  }

  return { categories, newChannels, seasonal };
}
