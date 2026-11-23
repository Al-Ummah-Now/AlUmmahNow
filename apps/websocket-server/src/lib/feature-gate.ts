/**
 * Feature switches in the realtime worker (FEAT-2, wiki AUN-FEATURES §5.1). The search D1 is
 * bound here, so the shared reader is used directly (rows memoised 30 s per isolate).
 *
 * Version 1 gates nothing: switching Live off stops new streams in api-videos, and the chat and
 * viewer counts of streams already on air continue. A future gated channel only needs an entry
 * in CHANNEL_FEATURES; a subscribe or message on it is then refused with code feature_off.
 */
import { featureGate, type FeatureKey } from '@al-ummah/shared-types';
import { logger } from './logger';

export interface ChannelFeature {
  /** Channels starting with this ('live:', 'video:') belong to the feature */
  prefix: string;
  key: FeatureKey;
}

export const CHANNEL_FEATURES: readonly ChannelFeature[] = Object.freeze([]);

/** The switched-off feature a channel belongs to, or null (no mapping: no read at all). */
export async function channelFeatureOff(
  env: { SEARCH_DB?: unknown; FEATURES_FORCE_OFF?: string },
  channel: string,
  map: readonly ChannelFeature[] = CHANNEL_FEATURES,
): Promise<FeatureKey | null> {
  const entry = map.find((m) => channel.startsWith(m.prefix));
  if (!entry) return null;
  try {
    return (await featureGate(env, entry.key)).on ? null : entry.key;
  } catch (error) {
    logger.warn('[FeatureGate] Switches unreadable; channel allowed', { key: entry.key, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
