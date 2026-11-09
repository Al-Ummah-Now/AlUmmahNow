/**
 * Dimensions collected for creator analytics: retention curves and traffic
 * sources (docs/specs/CREATOR-STUDIO.md §8.4). Shared by the player, the API
 * and the processor so they validate against one list.
 */

/** Retention splits a video into this many equal buckets (5% each). */
export const RETENTION_BUCKET_COUNT = 20;

export const TRAFFIC_SOURCES = [
  'home',
  'search',
  'subscriptions',
  'channel',
  'playlist',
  'up_next',
  'explore',
  'library',
  'notification',
  'embed',
  'external',
  'direct',
  'unknown',
] as const;

export type ViewTrafficSource = (typeof TRAFFIC_SOURCES)[number];

export function isTrafficSource(value: unknown): value is ViewTrafficSource {
  return typeof value === 'string' && (TRAFFIC_SOURCES as readonly string[]).includes(value);
}

const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MAX_HOST_LENGTH = 253;

/** A referrer is kept as a bare lower-case host: never a scheme, path or query. */
export function normalizeReferrerHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HOST_LENGTH) return null;
  const host = value.toLowerCase();
  return HOST_PATTERN.test(host) ? host : null;
}

/** Payload of MessageType.VideoRetention. */
export interface VideoRetentionPayload {
  videoId: string;
  /** Buckets (0-19) this session newly reached since its previous report */
  buckets: number[];
  /** Used for rate limiting only, and never stored in the rollup */
  sessionId: string;
  /** ISO time of the report (selects the rollup day) */
  timestamp: string;
}
