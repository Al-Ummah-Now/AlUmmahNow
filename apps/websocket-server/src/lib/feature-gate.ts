/**
 * Feature switches in the realtime worker (FEAT-2, wiki AUN-FEATURES §5.1). The search D1 is
 * bound here, so the shared reader is used directly (rows memoised 30 s per isolate).
 *
 * A gated channel needs an entry in CHANNEL_FEATURES; a subscribe or message on it is refused with
 * code feature_off while the switch is off. Live chat (wiki E17) also refuses while the switch
 * cannot be read. Switching Live off stops new streams in api-videos; those on air continue.
 */
import { featureGate, type FeatureKey } from '@al-ummah/shared-types';
import { logger } from './logger';

export interface ChannelFeature {
  /** Channels starting with this ('live:', 'video:') belong to the feature */
  prefix: string;
  key: FeatureKey;
  /** Refuse when the switch cannot be read (default: allow) */
  failClosed?: boolean;
}

export const CHANNEL_FEATURES: readonly ChannelFeature[] = Object.freeze([{ prefix: 'live:', key: 'liveChat', failClosed: true }]);

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
    logger.warn('[FeatureGate] Switches unreadable', { allowed: !entry.failClosed, key: entry.key, error: error instanceof Error ? error.message : String(error) });
    return entry.failClosed ? entry.key : null;
  }
}
