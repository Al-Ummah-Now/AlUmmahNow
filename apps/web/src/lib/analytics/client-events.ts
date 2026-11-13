/**
 * Pure helpers for client analytics beacons (no Next.js imports so they can be
 * unit tested and reused).
 */

import { sanitizeEventPayload, sanitizeText } from '@/lib/security/InputSanitizer';
import type { ConsentCategory } from '@/lib/consent/consent-cookie';

export type ClientEventKind = 'ab_test' | 'performance' | 'visit';

/** Consent category each beacon kind requires (Story 1.3, AC 4). */
export const CONSENT_FOR_KIND: Readonly<Record<ClientEventKind, ConsentCategory>> = {
  ab_test: 'experiments',
  performance: 'performance',
  // A visit's landing page and source: analytics consent, like views' traffic sources
  visit: 'analytics',
};

/** Fields never forwarded: identifiers the beacon has no need for (data minimisation). */
const STRIPPED_FIELDS = new Set(['email', 'ip', 'ipAddress', 'token', 'authorization', 'password']);

function stripIdentifiers(event: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(event)) {
    if (!STRIPPED_FIELDS.has(key)) out[key] = value;
  }
  if (typeof out.url === 'string') {
    // Drop query string and fragment: they may carry identifiers.
    out.url = out.url.split(/[?#]/)[0];
  }
  return out;
}

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
  const userAgent = typeof payload.userAgent === 'string' ? sanitizeText(payload.userAgent, 512) : undefined;
  const referrer = typeof payload.referrer === 'string' ? sanitizeText(payload.referrer.split(/[?#]/)[0], 2048) : undefined;

  let events: unknown[];
  if (Array.isArray(payload.events)) {
    events = payload.events;
  } else if (typeof payload.type === 'string' && 'data' in payload) {
    const items = Array.isArray(payload.data) ? payload.data : [payload.data];
    events = items.map(item => (isObject(item) ? { metricType: payload.type, ...item } : null));
  } else {
    events = [{ metricType: 'video-performance', ...payload }];
  }

  // Story 1.2 AC 5: sanitize before the events are processed downstream.
  const sanitized = events
    .filter(isObject)
    .slice(0, MAX_EVENTS)
    .map(event => sanitizeEventPayload<JsonObject>(event, { maxDepth: 4, maxStringLength: 1024 }).value)
    .filter(isObject)
    .map(stripIdentifiers);

  return {
    events: sanitized,
    ...(userAgent && { userAgent }),
    ...(referrer && { referrer }),
  };
}
