/**
 * Platform setting: per-user download rate limit (Epic 14, E14-D2).
 *
 * Stored in `global_settings/ops/download-rate-limit.json`, cached per isolate
 * for 30 s, and converted into a `RateLimitConfig` for the existing atomic D1
 * rate-limit engine (`middleware/rate-limit.ts`, operation `'offline_download'`).
 */

import {
	DEFAULT_DOWNLOAD_RATE_LIMIT,
	DOWNLOAD_RATE_LIMIT_CACHE_MS,
	DOWNLOAD_RATE_LIMIT_KEY,
	normaliseDownloadRateLimit,
	validateDownloadRateLimit,
	type DownloadRateLimitSettings,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import type { RateLimitConfig } from '../../middleware/rate-limit';

interface SettingsBucket {
	get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
	put(key: string, value: string, options?: unknown): Promise<unknown>;
}

let cache: { at: number; value: DownloadRateLimitSettings } | null = null;

export function clearDownloadRateLimitCache(): void {
	cache = null;
}

export async function readDownloadRateLimit(
	env: { global_settings?: unknown },
	fresh = false,
): Promise<DownloadRateLimitSettings> {
	if (!fresh && cache && Date.now() - cache.at < DOWNLOAD_RATE_LIMIT_CACHE_MS) return cache.value;
	let value: DownloadRateLimitSettings = { ...DEFAULT_DOWNLOAD_RATE_LIMIT };
	try {
		const obj = await (env.global_settings as SettingsBucket | undefined)?.get(DOWNLOAD_RATE_LIMIT_KEY);
		if (obj) value = normaliseDownloadRateLimit(await obj.json<unknown>());
	} catch (error) {
		logger.warn('[Downloads] Could not read download rate-limit settings; using defaults', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	cache = { at: Date.now(), value };
	return value;
}

export async function writeDownloadRateLimit(
	env: { global_settings?: unknown },
	input: { perDay: unknown; burstPerMinute: unknown },
	actorId: string,
): Promise<DownloadRateLimitSettings> {
	const bucket = env.global_settings as SettingsBucket | undefined;
	if (!bucket) throw new Error('global_settings is not bound');
	const parsed = validateDownloadRateLimit(input);
	if ('error' in parsed) {
		const err = parsed.error;
		throw new Error(
			err.reason === 'exceeds_per_day'
				? 'burstPerMinute must not exceed perDay'
				: `${err.field} must be a whole number from ${err.min} to ${err.max}`,
		);
	}
	const value: DownloadRateLimitSettings = {
		...parsed.value,
		updatedAt: new Date().toISOString(),
		updatedBy: actorId,
	};
	await bucket.put(DOWNLOAD_RATE_LIMIT_KEY, JSON.stringify(value), {
		httpMetadata: { contentType: 'application/json' },
	});
	cache = { at: Date.now(), value };
	return value;
}

/** Converts admin settings into a `RateLimitConfig` for `checkRateLimit(db, userId, 'offline_download', cfg)`. */
export function toDownloadRateLimitConfig(settings: Pick<DownloadRateLimitSettings, 'perDay' | 'burstPerMinute'>): RateLimitConfig {
	return {
		perMinute: settings.burstPerMinute,
		perHour: settings.perDay,
		perDay: settings.perDay,
		maxConcurrent: Math.min(10, Math.max(2, settings.burstPerMinute)),
	};
}
