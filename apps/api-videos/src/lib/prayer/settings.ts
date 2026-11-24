/**
 * Admin settings for the prayer-time and Hijri proxy (wiki Epic 21 §3 and §6, story 21.1c): the
 * provider adapter, the Hijri source, the gate limits and per-country method overrides. Stored as
 * one JSON object in the global_settings bucket with an optimistic version; admin-api audits every
 * change. The Features page stays the only on/off control.
 *
 * Reads are cached per isolate for a minute (a value, never a shared promise).
 */
import { aladhanProvider, type PrayerProvider } from './aladhan';
import { DEFAULT_GATE_LIMITS, type GateLimits } from './gate';
import { isPrayerMethodId, type HijriSource } from './methods';
import type { PrayerSettings } from './service';

export const PRAYER_SETTINGS_KEY = 'settings/prayer.json';
export const PRAYER_PROVIDERS = ['aladhan'] as const;
export type PrayerProviderId = (typeof PRAYER_PROVIDERS)[number];
export const HIJRI_SOURCES = ['HJCoSA', 'UAQ'] as const;
export const GATE_LIMIT_BOUNDS = { maxInFlight: { min: 1, max: 20 }, perSecond: { min: 1, max: 50 } } as const;
const CACHE_MS = 60_000;

export interface PrayerAdminSettings {
	version: number;
	provider: PrayerProviderId;
	hijriSource: HijriSource;
	limits: GateLimits;
	/** Country code → method id; replaces the shipped default for that country */
	countryMethods: Record<string, number>;
	updatedAt: string | null;
	updatedBy: string | null;
}

export const DEFAULT_PRAYER_ADMIN_SETTINGS: PrayerAdminSettings = {
	version: 0,
	provider: 'aladhan',
	hijriSource: 'HJCoSA',
	limits: { ...DEFAULT_GATE_LIMITS },
	countryMethods: {},
	updatedAt: null,
	updatedBy: null,
};

export class PrayerSettingsError extends Error {
	constructor(
		readonly status: 400 | 409,
		readonly code: 'invalid_request' | 'conflict',
		readonly detail?: string,
	) {
		super(detail ?? code);
	}
}

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** The stored object with anything missing or malformed at its default. */
export function normalizeSettings(raw: unknown): PrayerAdminSettings {
	const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrayerAdminSettings>;
	const countryMethods: Record<string, number> = {};
	for (const [cc, m] of Object.entries(s.countryMethods ?? {})) {
		if (/^[A-Z]{2}$/.test(cc) && typeof m === 'number' && isPrayerMethodId(m)) countryMethods[cc] = m;
	}
	return {
		version: int(s.version, 0, Number.MAX_SAFE_INTEGER) ?? 0,
		provider: (PRAYER_PROVIDERS as readonly string[]).includes(s.provider as string) ? (s.provider as PrayerProviderId) : 'aladhan',
		hijriSource: (HIJRI_SOURCES as readonly string[]).includes(s.hijriSource as string) ? (s.hijriSource as HijriSource) : 'HJCoSA',
		limits: {
			maxInFlight: int(s.limits?.maxInFlight, GATE_LIMIT_BOUNDS.maxInFlight.min, GATE_LIMIT_BOUNDS.maxInFlight.max) ?? DEFAULT_GATE_LIMITS.maxInFlight,
			perSecond: int(s.limits?.perSecond, GATE_LIMIT_BOUNDS.perSecond.min, GATE_LIMIT_BOUNDS.perSecond.max) ?? DEFAULT_GATE_LIMITS.perSecond,
		},
		countryMethods,
		updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
		updatedBy: typeof s.updatedBy === 'string' ? s.updatedBy : null,
	};
}

let cached: { at: number; value: PrayerAdminSettings } | null = null;

export async function readPrayerAdminSettings(env: { global_settings?: R2Bucket }, opts: { fresh?: boolean; now?: number } = {}): Promise<PrayerAdminSettings> {
	const now = opts.now ?? Date.now();
	if (!opts.fresh && cached && now - cached.at < CACHE_MS) return cached.value;
	const object = await env.global_settings?.get(PRAYER_SETTINGS_KEY).catch(() => null);
	const value = normalizeSettings(object ? await object.json().catch(() => null) : null);
	cached = { at: now, value };
	return value;
}

export function forgetPrayerSettingsCache(): void {
	cached = null;
}

export interface PrayerSettingsInput {
	version: number;
	provider?: string;
	hijriSource?: string;
	limits?: { maxInFlight?: number; perSecond?: number };
	countryMethods?: Record<string, number | null>;
}

/** Applies a change when `version` matches; a country set to null goes back to the shipped default. */
export async function writePrayerAdminSettings(env: { global_settings?: R2Bucket }, input: PrayerSettingsInput, actorId: string, now = new Date().toISOString()): Promise<{ previous: PrayerAdminSettings; settings: PrayerAdminSettings }> {
	if (!env.global_settings) throw new PrayerSettingsError(400, 'invalid_request', 'settings storage is not bound');
	const previous = await readPrayerAdminSettings(env, { fresh: true });
	if (input.version !== previous.version) throw new PrayerSettingsError(409, 'conflict');
	if (input.provider !== undefined && !(PRAYER_PROVIDERS as readonly string[]).includes(input.provider)) throw new PrayerSettingsError(400, 'invalid_request', 'provider');
	if (input.hijriSource !== undefined && !(HIJRI_SOURCES as readonly string[]).includes(input.hijriSource)) throw new PrayerSettingsError(400, 'invalid_request', 'hijriSource');
	const limits = { ...previous.limits };
	for (const key of ['maxInFlight', 'perSecond'] as const) {
		const v = input.limits?.[key];
		if (v === undefined) continue;
		const ok = int(v, GATE_LIMIT_BOUNDS[key].min, GATE_LIMIT_BOUNDS[key].max);
		if (ok === null) throw new PrayerSettingsError(400, 'invalid_request', `limits.${key}`);
		limits[key] = ok;
	}
	const countryMethods = { ...previous.countryMethods };
	for (const [cc, m] of Object.entries(input.countryMethods ?? {})) {
		if (!/^[A-Z]{2}$/.test(cc)) throw new PrayerSettingsError(400, 'invalid_request', 'countryMethods');
		if (m === null) delete countryMethods[cc];
		else if (typeof m === 'number' && isPrayerMethodId(m)) countryMethods[cc] = m;
		else throw new PrayerSettingsError(400, 'invalid_request', 'countryMethods');
	}
	const settings: PrayerAdminSettings = {
		version: previous.version + 1,
		provider: (input.provider as PrayerProviderId | undefined) ?? previous.provider,
		hijriSource: (input.hijriSource as HijriSource | undefined) ?? previous.hijriSource,
		limits,
		countryMethods,
		updatedAt: now,
		updatedBy: actorId,
	};
	await env.global_settings.put(PRAYER_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: 'application/json' } });
	cached = null;
	return { previous, settings };
}

const PROVIDERS: Record<PrayerProviderId, (fetchImpl?: typeof fetch) => PrayerProvider> = { aladhan: (f) => aladhanProvider(f) };

/** The service settings built from the admin settings. */
export function toPrayerSettings(admin: PrayerAdminSettings, fetchImpl?: typeof fetch): PrayerSettings {
	return { provider: PROVIDERS[admin.provider](fetchImpl), hijriSource: admin.hijriSource, limits: admin.limits };
}
