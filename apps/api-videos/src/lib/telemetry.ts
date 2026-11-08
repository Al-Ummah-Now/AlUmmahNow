/**
 * Client telemetry ingest (Epic 9.8): QoE, crash breadcrumbs and allow-listed
 * app events from native apps, written to Workers Analytics Engine.
 *
 * Privacy:
 * - Accepted only when the batch says `consent.analytics === true`; otherwise
 *   the whole batch is dropped (still 202, so clients never retry it).
 * - No user id and no IP. The install id is random, rotates with the app, and
 *   is stored only as a short SHA-256 prefix.
 * - Free text is limited to breadcrumbs (200 chars each) and scrubbed of email
 *   addresses, URL query strings, tokens and long numbers.
 * Sampling per event type comes from remote config (`telemetry.sample.<type>`,
 * 0..1, Epic 9.5); the choice is stable per install.
 */
import { z } from 'zod';
import { APPS, PLATFORMS, SEMVER } from './app-config';
import { rolloutBucket } from './feature-flags';

export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_EVENTS = 50;
export const MAX_TEXT = 200;

/** App events clients may send; anything else is rejected so names can't carry data. */
export const APP_EVENT_NAMES = [
	'app_open',
	'app_background',
	'sign_in',
	'sign_out',
	'playback_start',
	'playback_complete',
	'download_start',
	'download_complete',
	'cast_start',
	'search',
	'share',
	'subscribe',
	'update_prompt_shown',
	'update_prompt_accepted',
] as const;

const Ts = z.number().int().positive().optional().describe('Client time, ms since epoch');
const Code = z.string().max(64).regex(/^[A-Za-z0-9_.:-]+$/);

export const QoeEvent = z
	.object({
		type: z.literal('qoe'),
		ts: Ts,
		videoId: z.string().max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
		startupMs: z.number().min(0).max(600_000).optional(),
		rebufferRatio: z.number().min(0).max(1).optional(),
		bitrateSwitches: z.number().int().min(0).max(10_000).optional(),
		fatalErrorCode: Code.optional(),
	})
	.strict();

export const CrashBreadcrumbEvent = z
	.object({
		type: z.literal('crash_breadcrumb'),
		ts: Ts,
		errorCode: Code.optional(),
		breadcrumbs: z.array(z.string().max(2_000)).max(20),
	})
	.strict();

export const AppEvent = z
	.object({
		type: z.literal('app_event'),
		ts: Ts,
		name: z.enum(APP_EVENT_NAMES),
	})
	.strict();

export const TelemetryEvent = z.discriminatedUnion('type', [QoeEvent, CrashBreadcrumbEvent, AppEvent]);
export type TelemetryEventT = z.infer<typeof TelemetryEvent>;

export const TelemetryBatch = z
	.object({
		installId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
		app: z.enum(APPS),
		platform: z.enum(PLATFORMS),
		appVersion: z.string().regex(SEMVER),
		consent: z.object({ analytics: z.boolean() }),
		events: z.array(TelemetryEvent).min(1).max(MAX_EVENTS),
	})
	.strict();
export type TelemetryBatchT = z.infer<typeof TelemetryBatch>;

/** Removes things that identify people from free text, then truncates. */
export function scrubText(text: string): string {
	return text
		.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
		.replace(/\b(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1')
		.replace(/\b(Bearer|token|key|secret|password)([=:\s]+)\S+/gi, '$1$2[redacted]')
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
		.replace(/\d{6,}/g, '[number]')
		.slice(0, MAX_TEXT);
}

/** Sample rate 0..1 for an event type from evaluated remote config (default 1). */
export function sampleRate(config: Record<string, unknown>, type: TelemetryEventT['type']): number {
	const v = config[`telemetry.sample.${type}`];
	return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
}

/** Stable per install: the same install is always in or out for a type. */
export function inSample(installId: string, type: string, rate: number): boolean {
	if (rate >= 1) return true;
	if (rate <= 0) return false;
	return rolloutBucket(`telemetry.${type}`, installId) < rate * 100;
}

export async function hashInstallId(installId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`aun-telemetry:${installId}`));
	return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Analytics Engine row. Fixed column positions (query with blob1..blob7,
 * double1..double5):
 * - blobs:   type, app, platform, appVersion, name|errorCode, videoId, installHash
 * - doubles: startupMs, rebufferRatio, bitrateSwitches, clientTs, breadcrumbCount
 * - indexes: [type] (sampling key)
 * Breadcrumb text goes in blob8 (scrubbed, joined with " | ", <= 1 KB).
 */
export function toDataPoint(batch: TelemetryBatchT, event: TelemetryEventT, installHash: string): AnalyticsEngineDataPoint {
	const label = event.type === 'app_event' ? event.name : event.type === 'qoe' ? (event.fatalErrorCode ?? '') : (event.errorCode ?? '');
	const blobs = [
		event.type,
		batch.app,
		batch.platform,
		batch.appVersion,
		label,
		event.type === 'qoe' ? (event.videoId ?? '') : '',
		installHash,
	];
	if (event.type === 'crash_breadcrumb') blobs.push(event.breadcrumbs.map(scrubText).join(' | ').slice(0, 1024));
	return {
		indexes: [event.type],
		blobs,
		doubles: [
			event.type === 'qoe' ? (event.startupMs ?? -1) : -1,
			event.type === 'qoe' ? (event.rebufferRatio ?? -1) : -1,
			event.type === 'qoe' ? (event.bitrateSwitches ?? -1) : -1,
			event.ts ?? 0,
			event.type === 'crash_breadcrumb' ? event.breadcrumbs.length : 0,
		],
	};
}
