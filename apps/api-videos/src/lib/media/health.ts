/**
 * Provider health (docs/media-delivery/PROVIDERS.md §Health). Two signals per provider:
 *
 *   player fallback away from it (GET /api/videos/:id/playback?exclude=…, only when that provider
 *       was ready for the video) ─► media_provider_health, one row per provider, minute and reporter
 *       (a daily-salted client hash); the window counts distinct reporters, so one client cannot
 *       push a provider over the threshold by looping over videos
 *   cron, every minute ─► probe each enabled provider (adapter.probe) + sum failures in the window
 *       ─► nextProviderHealth ─► global_settings/ops/media-health.json
 *
 * The planner (playback.ts) reads the snapshot (cached 30 s) and moves an unhealthy provider behind
 * the healthy ones; it never drops the last way to play. A provider turning unhealthy is an Errors
 * page item (key media-provider-health:<id>, "Check now"), resolved when it is healthy again.
 */
import {
	MEDIA_PROVIDER_LABELS,
	nextProviderHealth,
	reportNeedsAction,
	resolveNeedsAction,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type MediaHealthSnapshot,
	type MediaProviderId,
	type ProviderHealth,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { allProviders, type ProvidersEnv } from './providers';
import { readMediaSettings } from './settings';

export const HEALTH_KEY = 'ops/media-health.json';
const HEALTH_TTL_MS = 30_000;
/** Minute rows kept (the window is at most an hour) */
const KEEP_MS = 24 * 3600_000;

export type HealthEnv = ProvidersEnv & { SEARCH_DB?: D1Database; global_settings?: R2Bucket };

let cache: { at: number; value: MediaHealthSnapshot | null } | null = null;

export function clearHealthCache(): void {
	cache = null;
}

const minuteOf = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16);

/**
 * Who reported a fallback, as a health signal: SHA-256 of the UTC day, the client IP and the user id,
 * truncated. Not linkable across days and never stored raw.
 */
export async function reporterKey(ip: string | null | undefined, userId: string | null | undefined, now = Date.now()): Promise<string> {
	const day = new Date(now).toISOString().slice(0, 10);
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`media-health|${day}|${ip ?? ''}|${userId ?? ''}`)));
	return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One player fallback away from `provider` by `reporter` (best effort, never throws). */
export async function countProviderFailure(env: Pick<HealthEnv, 'SEARCH_DB'>, provider: MediaProviderId, reporter: string, now = Date.now()): Promise<void> {
	if (!env.SEARCH_DB) return;
	try {
		await env.SEARCH_DB.prepare(
			`INSERT INTO media_provider_health (provider, minute, reporter, failures) VALUES (?1, ?2, ?3, 1)
			 ON CONFLICT (provider, minute, reporter) DO UPDATE SET failures = failures + 1`,
		)
			.bind(provider, minuteOf(now), reporter)
			.run();
	} catch (error) {
		logger.warn('[Media] Could not count a provider failure', { provider, error: error instanceof Error ? error.message : String(error) });
	}
}

export async function readHealth(env: Pick<HealthEnv, 'global_settings'>, fresh = false): Promise<MediaHealthSnapshot | null> {
	if (!fresh && cache && Date.now() - cache.at < HEALTH_TTL_MS) return cache.value;
	let value: MediaHealthSnapshot | null = null;
	try {
		value = ((await (await env.global_settings?.get(HEALTH_KEY))?.json<MediaHealthSnapshot>()) ?? null);
	} catch (error) {
		logger.warn('[Media] Could not read provider health', { error: error instanceof Error ? error.message : String(error) });
	}
	cache = { at: Date.now(), value };
	return value;
}

async function recentFailures(env: HealthEnv, windowMinutes: number, now: number): Promise<Partial<Record<MediaProviderId, number>>> {
	if (!env.SEARCH_DB) return {};
	const { results } = await env.SEARCH_DB.prepare('SELECT provider, COUNT(DISTINCT reporter) AS n FROM media_provider_health WHERE minute >= ?1 GROUP BY provider')
		.bind(minuteOf(now - (windowMinutes - 1) * 60_000))
		.all<{ provider: MediaProviderId; n: number }>();
	return Object.fromEntries((results ?? []).map((r) => [r.provider, Number(r.n) || 0]));
}

const needsActionKey = (p: MediaProviderId) => `media-provider-health:${p}`;

/**
 * One health pass (cron, every minute; the admin "Check now"). Probes every enabled provider,
 * writes the snapshot and raises or resolves the Errors page items. Never throws.
 */
export async function runHealthCheck(env: HealthEnv & ErrorReporterEnv, ctx?: ExecutionContextLike, now = new Date()): Promise<MediaHealthSnapshot | null> {
	try {
		const settings = await readMediaSettings(env);
		const prev = await readHealth(env, true);
		const failures = await recentFailures(env, settings.health.windowMinutes, now.getTime()).catch(() => ({}) as Partial<Record<MediaProviderId, number>>);
		const providers: Partial<Record<MediaProviderId, ProviderHealth>> = {};
		await Promise.all(
			allProviders().map(async (adapter) => {
				if (!settings.providers[adapter.id].enabled) return;
				const probe = await adapter.probe(env);
				const before = prev?.providers[adapter.id];
				const next = nextProviderHealth(before, { recentFailures: failures[adapter.id] ?? 0, probeOk: probe.ok, probeMs: probe.ms }, settings.health, now);
				providers[adapter.id] = next;
				if (next.state !== before?.state) {
					if (next.state === 'unhealthy') {
						logger.error('[Media] Provider unhealthy; playback moves off it', { provider: adapter.id, reason: next.reason, probe });
						reportNeedsAction('api-videos', env, ctx, {
							key: needsActionKey(adapter.id),
							source: 'processing',
							title: `${MEDIA_PROVIDER_LABELS[adapter.id]} is failing`,
							message: `${next.reason}. Playback uses the other providers first until it recovers${settings.health.enabled ? '' : ' (health-based fallback is off in the Delivery settings)'}.`,
							itemType: 'setting',
							itemId: adapter.id,
							itemUrl: '/delivery',
							retry: { kind: 'service', service: 'api-videos', path: '/internal/media/health/check', body: {} },
							retryLabel: 'Check now',
							extra: { provider: adapter.id, probeStatus: probe.status ?? null, probeError: probe.error ?? null, recentFailures: next.recentFailures },
						});
					} else if (before) {
						logger.warn('[Media] Provider healthy again', { provider: adapter.id });
						resolveNeedsAction(env, ctx, needsActionKey(adapter.id));
					}
				}
			}),
		);
		const snapshot: MediaHealthSnapshot = { providers, checkedAt: now.toISOString() };
		await env.global_settings?.put(HEALTH_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
		cache = { at: Date.now(), value: snapshot };
		// Old minute rows go once an hour
		if (now.getUTCMinutes() === 0 && env.SEARCH_DB) {
			await env.SEARCH_DB.prepare('DELETE FROM media_provider_health WHERE minute < ?1').bind(minuteOf(now.getTime() - KEEP_MS)).run().catch(() => undefined);
		}
		return snapshot;
	} catch (error) {
		logger.error('[Media] Provider health check failed', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
