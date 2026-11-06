/**
 * Pure helpers for client analytics beacons (no Next.js imports so they can be
 * unit tested and reused).
 */

export type ClientEventKind = 'ab_test' | 'performance';

export const MAX_EVENTS = 100;
export const MAX_BODY_BYTES = 64 * 1024;

export type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize the beacon payload shapes the web app sends into a flat event list:
 * - A/B testing:        { events: [...], userAgent?, referrer? }
 * - Web vitals:         { type: 'web-vitals', data: {...} } or { type: 'web-vitals-batch', data: [...] }
 * - Player performance: a single metrics object
 */
export function normalizeClientEvents(payload: unknown): { events: JsonObject[]; userAgent?: string; referrer?: string } {
  if (!isObject(payload)) return { events: [] };
  const userAgent = typeof payload.userAgent === 'string' ? payload.userAgent.slice(0, 512) : undefined;
  const referrer = typeof payload.referrer === 'string' ? payload.referrer.slice(0, 2048) : undefined;

  let events: unknown[];
  if (Array.isArray(payload.events)) {
    events = payload.events;
  } else if (typeof payload.type === 'string' && 'data' in payload) {
    const items = Array.isArray(payload.data) ? payload.data : [payload.data];
    events = items.map(item => (isObject(item) ? { metricType: payload.type, ...item } : null));
  } else {
    events = [{ metricType: 'video-performance', ...payload }];
  }

  return {
    events: events.filter(isObject).slice(0, MAX_EVENTS),
    ...(userAgent && { userAgent }),
    ...(referrer && { referrer }),
  };
}
