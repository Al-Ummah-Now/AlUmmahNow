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
