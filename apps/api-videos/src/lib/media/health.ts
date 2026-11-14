/**
 * Provider health (docs/media-delivery/PROVIDERS.md §Health). Two signals per provider:
 *
 *   player fallback away from it (GET /api/videos/:id/playback?exclude=…, only when that provider
 *       was ready for the video) ─► media_provider_health, one row per provider, minute and reporter
 *       (keyed hash of the client's /64 or IPv4); the window counts distinct reporters, so one
 *       client cannot push a provider over the threshold by looping over videos
 *   cron, every minute ─► sum failures in the window (one D1 read; no rows when idle)
 *       ├─ quiet (no failures, every provider healthy, last pass < IDLE_CHECK_MINUTES ago) ─► stop
 *       └─ otherwise probe each enabled provider (adapter.probe) ─► nextProviderHealth
 *            ─► global_settings/ops/media-health.json, written only when the health changed or the
 *               stored pass is IDLE_CHECK_MINUTES old (idle: one probe pair and one write per 15 min)
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
/**
 * With no player failures and every provider healthy, a full pass (probes and the snapshot write)
 * runs this often instead of every minute: the idle cost stays one D1 read and one R2 read a minute.
 * A single player fallback, a failed probe or an unhealthy provider brings back the minute cadence.
 */
export const IDLE_CHECK_MINUTES = 15;

export type HealthEnv = ProvidersEnv & { SEARCH_DB?: D1Database; global_settings?: R2Bucket };

let cache: { at: number; value: MediaHealthSnapshot | null } | null = null;

export function clearHealthCache(): void {
	cache = null;
}

const minuteOf = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 16);

/** The network a client reports from: an IPv6 /64 (one subscriber or host) or the IPv4 address. */
export function reporterNetwork(ip: string | null | undefined): string | null {
	const v = (ip ?? '').trim().toLowerCase();
	if (!v) return null;
	if (!v.includes(':')) return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : null;
	// Expand "::" so the first four groups are the /64
	const [head, tail = ''] = v.split('::');
	const h = head ? head.split(':') : [];
	const t = v.includes('::') ? (tail ? tail.split(':') : []) : [];
	const groups = v.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
	if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
	return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Who reported a fallback, as a health signal: HMAC-SHA-256 of the client's network
 * (reporterNetwork) keyed with MEDIA_SIGN_KEY and the UTC day, truncated. Without the key it cannot
 * be reversed to an address, and rows are unlinkable across days. Null (nothing counted) without a
 * network or a key.
 */
export async function reporterKey(ip: string | null | undefined, key: string | null | undefined, now = Date.now()): Promise<string | null> {
	const network = reporterNetwork(ip);
	if (!network || !key) return null;
	const day = new Date(now).toISOString().slice(0, 10);
	const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(`media-health|${day}|${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(network)));
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

/** The parts of a provider's health the planner, the Errors page and the next pass depend on. */
function healthFingerprint(snapshot: MediaHealthSnapshot | null | undefined): string {
	return JSON.stringify(
		Object.entries(snapshot?.providers ?? {})
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([p, h]) => [p, h?.state, h?.until, h?.reason, h?.recentFailures, h?.consecutiveProbeFailures, h?.lastProbeOk]),
	);
}

/** Nothing to watch closely: no player failures in the window, no failed probe, nobody unhealthy. */
export function isQuiet(prev: MediaHealthSnapshot | null, failures: Partial<Record<MediaProviderId, number>>): boolean {
	if (!prev) return false;
	if (Object.values(failures).some((n) => (n ?? 0) > 0)) return false;
	return Object.values(prev.providers).every((h) => !h || (h.state === 'healthy' && h.consecutiveProbeFailures === 0));
}

const minutesSince = (iso: string | undefined, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / 60_000 : Infinity);

/**
 * One health pass (cron, every minute; the admin "Check now" with `force`). Probes every enabled
 * provider, writes the snapshot when it changed and raises or resolves the Errors page items.
 * While quiet, the cron's pass stops after one D1 and one R2 read until IDLE_CHECK_MINUTES have
 * passed since the stored pass. Never throws. Returns the current snapshot (stored or new).
 */
export async function runHealthCheck(env: HealthEnv & ErrorReporterEnv, ctx?: ExecutionContextLike, now = new Date(), opts: { force?: boolean } = {}): Promise<MediaHealthSnapshot | null> {
	try {
		const settings = await readMediaSettings(env);
		const failures = await recentFailures(env, settings.health.windowMinutes, now.getTime()).catch(() => ({}) as Partial<Record<MediaProviderId, number>>);
		const prev = await readHealth(env, true);
		// Settled seconds early so a pass scheduled exactly 15 minutes later is not skipped by clock jitter
		if (!opts.force && isQuiet(prev, failures) && minutesSince(prev?.checkedAt, now) < IDLE_CHECK_MINUTES - 0.5) {
			logger.debug('[Media] Health quiet; full pass skipped', { checkedAt: prev?.checkedAt });
			return prev;
		}
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
		// Write only what matters: a change, a forced check, or the idle cadence (checkedAt is the stored pass)
		const changed = healthFingerprint(snapshot) !== healthFingerprint(prev);
		if (!opts.force && !changed && minutesSince(prev?.checkedAt, now) < IDLE_CHECK_MINUTES - 0.5) {
			cache = { at: Date.now(), value: prev };
			return prev;
		}
		await env.global_settings?.put(HEALTH_KEY, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
		cache = { at: Date.now(), value: snapshot };
		// Old minute rows go on the first stored pass of each hour
		const hourStart = Math.floor(now.getTime() / 3600_000) * 3600_000;
		if ((!prev?.checkedAt || Date.parse(prev.checkedAt) < hourStart) && env.SEARCH_DB) {
			await env.SEARCH_DB.prepare('DELETE FROM media_provider_health WHERE minute < ?1').bind(minuteOf(now.getTime() - KEEP_MS)).run().catch(() => undefined);
		}
		return snapshot;
	} catch (error) {
		logger.error('[Media] Provider health check failed', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
