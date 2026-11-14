/**
 * Provider settings store (docs/media-delivery/PROVIDERS.md): one object per environment at
 * global_settings/ops/media-delivery.json, the key the legacy delivery switch used.
 *
 * - Read: a stored legacy switch ({ mode, r2Percent, assign, transcode }) is migrated in memory,
 *   so day one behaves exactly as before (normaliseMediaSettings → settingsFromLegacy).
 * - Write: provider settings (version 2) plus the legacy fields derived from them, so a Worker
 *   version that still reads the legacy shape (a rollback) plays and transcodes the same way.
 * Cached 30 s per isolate, like before.
 */
import {
	legacyFromSettings,
	normaliseMediaSettings,
	settingsFromLegacy,
	settingsProblems,
	type DeliverySettings,
	type MediaSettings,
	type SettingsProblem,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export const SETTINGS_KEY = 'ops/media-delivery.json';
const SETTINGS_TTL_MS = 30_000;

type SettingsEnv = { global_settings?: R2Bucket };

let cache: { at: number; value: MediaSettings } | null = null;

export function clearMediaSettingsCache(): void {
	cache = null;
}

export class MediaSettingsError extends Error {
	constructor(readonly problems: { problem: SettingsProblem; detail?: string }[]) {
		super(`Settings refused: ${problems.map((p) => (p.detail ? `${p.problem} (${p.detail})` : p.problem)).join(', ')}`);
		this.name = 'MediaSettingsError';
	}
}

export async function readMediaSettings(env: SettingsEnv, fresh = false): Promise<MediaSettings> {
	if (!fresh && cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.value;
	let value = normaliseMediaSettings(null);
	try {
		const obj = await env.global_settings?.get(SETTINGS_KEY);
		if (obj) value = normaliseMediaSettings(await obj.json());
	} catch (error) {
		logger.warn('[Media] Could not read provider settings; using defaults', { error: error instanceof Error ? error.message : String(error) });
	}
	cache = { at: Date.now(), value };
	return value;
}

/**
 * Replace the settings with `next` (already merged by the caller), refusing anything that would
 * leave new uploads unplayable or use a provider that is off.
 */
export async function saveMediaSettings(env: SettingsEnv, next: unknown, actorId: string): Promise<MediaSettings> {
	if (!env.global_settings) throw new Error('global_settings is not bound');
	const value = normaliseMediaSettings({ ...(next as object), version: 2, updatedAt: new Date().toISOString(), updatedBy: actorId });
	const problems = settingsProblems(value);
	if (problems.length) throw new MediaSettingsError(problems);
	const legacy = legacyFromSettings(value);
	const stored = { ...value, mode: legacy.mode, r2Percent: legacy.r2Percent, assign: legacy.assign, transcode: legacy.transcode };
	await env.global_settings.put(SETTINGS_KEY, JSON.stringify(stored), { httpMetadata: { contentType: 'application/json' } });
	cache = { at: Date.now(), value };
	logger.warn('[Media] Provider settings changed', {
		actorId,
		ingest: value.ingest,
		strategy: value.playback.strategy,
		order: value.playback.order,
		enabled: Object.entries(value.providers).filter(([, p]) => p.enabled).map(([id]) => id),
	});
	return value;
}

/** Merge a partial change (top-level fields replace) and save. */
export async function updateMediaSettings(env: SettingsEnv, patch: Partial<MediaSettings>, actorId: string): Promise<MediaSettings> {
	const current = await readMediaSettings(env, true);
	return saveMediaSettings(env, { ...current, ...patch }, actorId);
}

/** The legacy switch view of the current settings (code that only knows the old shape). */
export async function readLegacyDeliverySettings(env: SettingsEnv, fresh = false): Promise<DeliverySettings> {
	return legacyFromSettings(await readMediaSettings(env, fresh));
}

/**
 * A change made in the legacy shape: playback and the R2 ingest flag are rebuilt from it; provider
 * switches, health, thumbnails and channel overrides are kept.
 */
export async function writeLegacyDeliverySettings(env: SettingsEnv, input: Partial<DeliverySettings>, actorId: string): Promise<DeliverySettings> {
	const current = await readMediaSettings(env, true);
	const migrated = settingsFromLegacy({ ...legacyFromSettings(current), ...input });
	const ingest = migrated.ingest.includes('r2') ? [...new Set([...current.ingest, 'r2' as const])] : current.ingest.filter((p) => p !== 'r2');
	const saved = await saveMediaSettings(env, { ...current, playback: migrated.playback, ingest: ingest.length ? ingest : ['bunny'] }, actorId);
	return legacyFromSettings(saved);
}
