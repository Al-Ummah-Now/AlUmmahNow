/**
 * Prayer times and Hijri dates by city and month (wiki Epic 21 §3, E21-D1 and E21-D2).
 *
 * Order of reads: the R2 last-good copy (fresh for FRESH_MS), else one upstream call through the
 * gate (coalesced per key within the isolate and across isolates by a D1 lease), else the stale
 * copy marked `stale: true`, else `null` (the route answers 503). Nothing is ever computed or
 * interpolated here: every time and Hijri date comes from the provider.
 */
import { logger } from '../logger';
import { aladhanProvider, ProviderError, type HijriDay, type PrayerDay, type PrayerProvider } from './aladhan';
import { acquire, release, DEFAULT_GATE_LIMITS, type GateLimits } from './gate';
import type { PrayerCity } from './cities';
import type { AsrMethod, HijriSource, PrayerMethodId } from './methods';

/** A stored month is served without asking the provider for this long */
export const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** A request that finds another isolate fetching waits this long for its result */
export const WAIT_FOR_OTHERS_MS = 2000;
const WAIT_STEP_MS = 250;

export interface PrayerEnv {
	SEARCH_DB?: D1Database;
	global_settings?: R2Bucket;
}

export interface PrayerSettings {
	provider: PrayerProvider;
	hijriSource: HijriSource;
	limits: GateLimits;
}

export function defaultPrayerSettings(fetchImpl?: typeof fetch): PrayerSettings {
	return { provider: aladhanProvider(fetchImpl), hijriSource: 'HJCoSA', limits: DEFAULT_GATE_LIMITS };
}

interface Stored<T> {
	fetchedAt: string;
	provider: string;
	hijriSource: HijriSource;
	days: T[];
}

export interface MonthResult<T> {
	days: T[];
	fetchedAt: string;
	stale: boolean;
}

/** Calendar months a client may ask for: last month to 12 months ahead (fixed windows only) */
export function allowedMonth(month: string, now = new Date()): boolean {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
	if (!m) return false;
	const index = Number(m[1]) * 12 + Number(m[2]) - 1;
	const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
	return index >= current - 1 && index <= current + 12;
}

export function prayerKey(provider: string, hijri: HijriSource, method: PrayerMethodId, asr: AsrMethod, cityId: string, month: string): string {
	return `prayer/${provider}/${hijri}/${method}/${asr}/${cityId}/${month}.json`;
}

export function hijriKey(provider: string, hijri: HijriSource, month: string): string {
	return `prayer/${provider}/${hijri}/hijri/${month}.json`;
}

/** Coalescing within this isolate: concurrent misses for one key share one promise */
const inFlight = new Map<string, Promise<unknown>>();

async function readStored<T>(bucket: R2Bucket | undefined, key: string): Promise<Stored<T> | null> {
	if (!bucket) return null;
	try {
		const object = await bucket.get(key);
		return object ? ((await object.json()) as Stored<T>) : null;
	} catch (error) {
		logger.warn('[Prayer] Stored month unreadable', { key, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadMonth<T>(
	env: PrayerEnv,
	settings: PrayerSettings,
	key: string,
	fetchDays: () => Promise<T[]>,
	nowMs: () => number,
): Promise<MonthResult<T> | null> {
	const stored = await readStored<T>(env.global_settings, key);
	if (stored && nowMs() - Date.parse(stored.fetchedAt) < FRESH_MS) return { days: stored.days, fetchedAt: stored.fetchedAt, stale: false };
	const staleAnswer = stored ? { days: stored.days, fetchedAt: stored.fetchedAt, stale: true } : null;
	const db = env.SEARCH_DB;
	if (!db || !env.global_settings) return staleAnswer;

	const shared = inFlight.get(key) as Promise<MonthResult<T> | null> | undefined;
	if (shared) return (await shared) ?? staleAnswer;

	const work = (async (): Promise<MonthResult<T> | null> => {
		const provider = settings.provider.id;
		const gate = await acquire(db, provider, key, settings.limits, nowMs());
		if (!gate.ok) {
			if (gate.reason === 'busy') {
				// Another isolate is fetching this key: wait for its copy
				for (let waited = 0; waited < WAIT_FOR_OTHERS_MS; waited += WAIT_STEP_MS) {
					await sleep(WAIT_STEP_MS);
					const fresh = await readStored<T>(env.global_settings, key);
					if (fresh && (!stored || fresh.fetchedAt !== stored.fetchedAt)) return { days: fresh.days, fetchedAt: fresh.fetchedAt, stale: false };
				}
			}
			logger.debug('[Prayer] Gate refused', { key, reason: gate.reason });
			return null;
		}
		try {
			const days = await fetchDays();
			const fetchedAt = new Date(nowMs()).toISOString();
			const record: Stored<T> = { fetchedAt, provider, hijriSource: settings.hijriSource, days };
			await env.global_settings!.put(key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
			await release(db, provider, key, gate.leaseId, { ok: true }, nowMs());
			return { days, fetchedAt, stale: false };
		} catch (error) {
			const providerError = error instanceof ProviderError ? error : null;
			// 429, 5xx and network failures count toward the breaker; a 4xx is our request's fault
			const counts = !providerError || providerError.status === 0 || providerError.status === 429 || providerError.status >= 500;
			await release(db, provider, key, gate.leaseId, { ok: false, retryAfterMs: providerError?.retryAfterMs ?? null, counts }, nowMs());
			logger.warn('[Prayer] Provider call failed', { key, status: providerError?.status ?? 'error', error: error instanceof Error ? error.message : String(error) });
			return null;
		}
	})();
	inFlight.set(key, work);
	try {
		return (await work) ?? staleAnswer;
	} finally {
		inFlight.delete(key);
	}
}

export function prayerMonth(
	env: PrayerEnv,
	settings: PrayerSettings,
	q: { city: PrayerCity; month: string; method: PrayerMethodId; asr: AsrMethod },
	nowMs: () => number = Date.now,
): Promise<MonthResult<PrayerDay> | null> {
	const key = prayerKey(settings.provider.id, settings.hijriSource, q.method, q.asr, q.city.id, q.month);
	return loadMonth(env, settings, key, () => settings.provider.fetchMonth(q.city, q.month, q.method, q.asr, settings.hijriSource), nowMs);
}

export function hijriMonth(env: PrayerEnv, settings: PrayerSettings, month: string, nowMs: () => number = Date.now): Promise<MonthResult<HijriDay> | null> {
	const key = hijriKey(settings.provider.id, settings.hijriSource, month);
	return loadMonth(env, settings, key, () => settings.provider.fetchHijriMonth(month, settings.hijriSource), nowMs);
}

/** For tests: forget in-isolate coalescing state */
export function forgetPrayerInFlight(): void {
	inFlight.clear();
}
