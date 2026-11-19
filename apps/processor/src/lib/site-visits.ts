/**
 * Site visit counters (owner decision D-SEO-9, wiki AUN-SEO): where visits to the videos site start
 * and where they come from, as daily counters in analytics_daily (entity 'site', id 'videos').
 * Aggregates only: no ids, no IP, no user agent. Dimensions are bounded (allow-listed landing kinds
 * and sources, maxDims on referrer hosts) so a forged beacon cannot grow the table.
 */
import { isShortLinkClickEvent, isSiteVisitEvent, normalizeReferrerHost } from '@al-ummah/shared-types';
import type { CounterIncrement } from './analytics-counters';

export const SITE_ENTITY_ID = 'videos';
const MAX_SOURCE_DIMS = 60;
const MAX_REFERRER_DIMS = 100;

/** Bounds of the request-origin breakdowns (owner: countries are the top 50 + "other"; UTM source only). */
export const ORIGIN_DIM_LIMITS = { surface: 16, device: 5, country: 50, campaign: 30 } as const;

/** Surface, device, country and campaign counters of one view or visit (absent fields add nothing). */
export function originIncrements(
	base: Omit<CounterIncrement, 'metric' | 'dim' | 'value' | 'maxDims'>,
	origin: { surface?: unknown; device?: unknown; country?: unknown; campaign?: unknown },
): CounterIncrement[] {
	const out: CounterIncrement[] = [];
	if (typeof origin.surface === 'string' && /^[a-z_]{2,12}$/.test(origin.surface)) out.push({ ...base, metric: 'surface', dim: origin.surface, value: 1, maxDims: ORIGIN_DIM_LIMITS.surface });
	if (typeof origin.device === 'string' && /^(phone|tablet|desktop|tv|unknown)$/.test(origin.device)) out.push({ ...base, metric: 'device', dim: origin.device, value: 1, maxDims: ORIGIN_DIM_LIMITS.device });
	if (typeof origin.country === 'string' && /^[A-Z]{2}$/.test(origin.country)) out.push({ ...base, metric: 'country', dim: origin.country, value: 1, maxDims: ORIGIN_DIM_LIMITS.country });
	if (typeof origin.campaign === 'string' && /^[a-z0-9._-]{1,40}$/.test(origin.campaign)) out.push({ ...base, metric: 'campaign', dim: origin.campaign, value: 1, maxDims: ORIGIN_DIM_LIMITS.campaign });
	return out;
}

/** The counter increments of one visit beacon batch, on the day it was received. */
export function visitIncrements(events: unknown[], receivedAt: string): CounterIncrement[] {
	const day = /^\d{4}-\d{2}-\d{2}/.test(receivedAt) ? receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
	const out: CounterIncrement[] = [];
	const base = { entityType: 'site' as const, entityId: SITE_ENTITY_ID, day };
	// One visit per beacon page load; more than a handful in one batch is not a person
	for (const event of events.slice(0, 5)) {
		if (!isSiteVisitEvent(event)) continue;
		out.push({ ...base, metric: 'visits', value: 1 });
		out.push({ ...base, metric: 'landing', dim: event.landing, value: 1 });
		out.push({ ...base, metric: 'source', dim: event.source, value: 1, maxDims: MAX_SOURCE_DIMS });
		const host = normalizeReferrerHost(event.referrerHost);
		if (host && event.source !== 'direct') out.push({ ...base, metric: 'referrer_host', dim: host, value: 1, maxDims: MAX_REFERRER_DIMS });
		out.push(...originIncrements(base, event));
	}
	return out;
}

/** Short link clicks (alummahnow.link, wiki AUN-SHORT-LINKS): entity 'site', id 'short-links'. */
export const SHORT_LINKS_ENTITY_ID = 'short-links';

/**
 * The counter increments of one short link click batch (the short-links Worker sends one click per
 * request): total clicks, per link type and per source. No id, IP or user agent.
 */
export function shortLinkIncrements(events: unknown[], receivedAt: string): CounterIncrement[] {
	const day = /^\d{4}-\d{2}-\d{2}/.test(receivedAt) ? receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
	const out: CounterIncrement[] = [];
	const base = { entityType: 'site' as const, entityId: SHORT_LINKS_ENTITY_ID, day };
	for (const event of events.slice(0, 5)) {
		if (!isShortLinkClickEvent(event)) continue;
		out.push({ ...base, metric: 'clicks', value: 1 });
		out.push({ ...base, metric: 'type', dim: event.type, value: 1 });
		out.push({ ...base, metric: 'source', dim: event.source, value: 1, maxDims: MAX_SOURCE_DIMS });
	}
	return out;
}
