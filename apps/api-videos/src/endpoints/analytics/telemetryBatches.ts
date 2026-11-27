/**
 * Native app telemetry & crash batch ingest (AlUmmahNowCore#8 / Epic 9.8).
 *
 * POST /api/telemetry/batches (and /api/v1/telemetry/batches)
 * Accepts `aun_telemetry::TelemetryBatch` JSON batches posted by `aun_telemetry::HttpSink`:
 * - Bounded streaming body read (256 KB cap) before JSON parsing
 * - Per-caller rate limiting (hashed IP or userId; raw IP never stored)
 * - Atomic event-ID deduplication in SEARCH_DB.telemetry_dedupe (24h TTL, rolled back on 503 retry)
 * - Routes `analytics` and `qoe` events to `MessageType.ClientAnalyticsEvent` (archived to R2)
 * - Routes `error` and `crash` events (with breadcrumbs & stack) to admin-api `POST /internal/errors`
 *   with deterministic `ERR-XXXX-XXXX` references so retries never create duplicate refs.
 */
import { z } from 'zod';
import {
	ERROR_LIMITS,
	errorRefFromDigest,
	scrubEvent,
	scrubText,
	type ErrorApp,
	type ErrorBreadcrumb,
	type ErrorEventInput,
} from '@al-ummah/shared-types';
import { OptionalAuthRoute, type AppContext } from '../../base';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';
import { MessageType } from '../../lib/queue';
import { checkRateLimit, releaseRateLimit, type RateLimitConfig } from '../../middleware/rate-limit';

export const TELEMETRY_MAX_BODY_BYTES = 256 * 1024;
export const TELEMETRY_MAX_EVENT_BYTES = 64 * 1024;
export const TELEMETRY_MAX_EVENTS = 100;
export const TELEMETRY_MAX_BREADCRUMBS = 50;
export const TELEMETRY_MAX_PROPERTIES = 50;
export const TELEMETRY_PENDING_TTL_MS = 60 * 1000;
export const TELEMETRY_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
export const TELEMETRY_RATE_LIMIT: RateLimitConfig = {
	perMinute: 30,
	perHour: 300,
	perDay: 2000,
	maxConcurrent: 5,
};
const FORWARD_MAX_BODY_BYTES = 58 * 1024;
/** Cloudflare Queues hard cap is 128 KB per message; keep plenty of headroom for envelope metadata. */
const QUEUE_MAX_BODY_BYTES = 96 * 1024;
const EVENT_NAME_RE = /^[a-z0-9_.]{1,64}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const PropValueSchema = z.union([z.string().max(16_384), z.number().finite(), z.boolean()]);

const BreadcrumbSchema = z.object({
	timestamp_ms: z.number().int(),
	category: z.string().min(1).max(64),
	message: z.string().max(1024),
	level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
});

const TelemetryEventSchema = z.object({
	id: z.string().regex(EVENT_ID_RE),
	kind: z.enum(['analytics', 'qoe', 'error', 'crash']),
	name: z.string().regex(EVENT_NAME_RE),
	timestamp_ms: z.number().int(),
	session_id: z.string().min(1).max(64),
	properties: z
		.record(z.string().min(1).max(64), PropValueSchema)
		.refine((p) => Object.keys(p).length <= TELEMETRY_MAX_PROPERTIES, 'Too many properties')
		.meta({
			description: 'Up to 50 flat primitive properties (keys 1-64 chars, string values up to 16,384 chars)',
			maxProperties: TELEMETRY_MAX_PROPERTIES,
			propertyNames: { type: 'string', minLength: 1, maxLength: 64 },
		})
		.optional()
		.default({}),
	breadcrumbs: z.array(BreadcrumbSchema).max(TELEMETRY_MAX_BREADCRUMBS).optional().default([]),
}).refine(
	(ev) => new TextEncoder().encode(JSON.stringify(ev)).byteLength <= TELEMETRY_MAX_EVENT_BYTES,
	'Telemetry event exceeds per-event size limit',
).meta({
	description: 'Single telemetry or crash event (max 64 KiB serialized JSON)',
});

const AppInfoSchema = z.object({
	platform: z.string().min(1).max(64),
	app_version: z.string().max(64).default(''),
	os_version: z.string().max(64).default(''),
	device_class: z.string().max(32).default(''),
	locale: z.string().max(32).default(''),
	core_version: z.string().max(64).optional().default(''),
});

export const TelemetryBatchBody = z.object({
	batch_id: z.string().min(1).max(64),
	sent_at_ms: z.number().int(),
	app: AppInfoSchema,
	events: z.array(TelemetryEventSchema).min(1).max(TELEMETRY_MAX_EVENTS),
});

export type TelemetryBatchInput = z.infer<typeof TelemetryBatchBody>;
export type TelemetryEventInput = z.infer<typeof TelemetryEventSchema>;
export type TelemetryAppInput = z.infer<typeof AppInfoSchema>;

/** Reads a request body up to `maxBytes` without buffering unbounded payloads into memory. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
	const cl = request.headers.get('content-length');
	if (cl !== null && /^\d+$/.test(cl.trim()) && Number(cl) > maxBytes) return null;
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

/** Maps `aun_telemetry::AppInfo.platform` to an `ERROR_APPS` identifier. */
export function mapTelemetryPlatformToErrorApp(platform: string): ErrorApp {
	const p = platform.trim().toLowerCase();
	if (p === 'ios' || p === 'ipados') return 'ios';
	if (p === 'macos' || p === 'osx') return 'macos';
	if (p === 'tvos') return 'tvos';
	if (p === 'android' || p === 'androidtv' || p === 'android-tv') return 'android';
	return 'desktop';
}

function safeIsoFromMs(ms: number, fallbackMs: number): string {
	// Keep timestamps within [2020-01-01, now + 1 day] so bogus client clocks don't distort timelines
	const minMs = Date.UTC(2020, 0, 1);
	const maxMs = fallbackMs + 86_400_000;
	const clamped = Number.isFinite(ms) && ms >= minMs && ms <= maxMs ? ms : fallbackMs;
	return new Date(clamped).toISOString();
}

function safeBreadcrumbKind(category: string): string {
	const clean = category.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
	return clean && /^[a-z]/.test(clean) ? clean.slice(0, 20) : 'step';
}

/** Converts a native `error` or `crash` telemetry event into a scrubbed `ErrorEventInput`. */
export function telemetryEventToErrorInput(
	event: TelemetryEventInput,
	app: TelemetryAppInput,
	environment: string,
	nowMs = Date.now(),
): ErrorEventInput | null {
	const props = event.properties ?? {};
	const isCrash = event.kind === 'crash';
	const errorApp = mapTelemetryPlatformToErrorApp(app.platform);
	const kind = isCrash ? 'crash' : event.name === 'playback_error' ? 'player' : 'caught';

	const rawName = isCrash
		? (typeof props.kind === 'string' && props.kind.trim() ? props.kind.trim() : 'NativeCrash')
		: (typeof props.code === 'string' && props.code.trim() ? props.code.trim() : event.name);

	const rawMessage = isCrash
		? (typeof props.message === 'string' && props.message.trim() ? props.message.trim() : rawName)
		: (typeof props.detail === 'string' && props.detail.trim()
			? props.detail.trim()
			: typeof props.message === 'string' && props.message.trim()
				? props.message.trim()
				: `${event.name}: ${rawName}`);

	const stack = isCrash && typeof props.stack === 'string' && props.stack.trim() ? props.stack : undefined;

	const occurredMs =
		isCrash && typeof props.occurred_at_ms === 'number' && props.occurred_at_ms > 0
			? props.occurred_at_ms
			: event.timestamp_ms;

	const extra: Record<string, string | number | boolean | null> = {};
	if (app.platform) extra.platform = app.platform.slice(0, 64);
	if (app.os_version) extra.osVersion = app.os_version.slice(0, 64);
	if (app.device_class) extra.deviceClass = app.device_class.slice(0, 32);
	if (app.core_version) extra.coreVersion = app.core_version.slice(0, 64);
	extra.telemetryEvent = event.name;
	for (const [k, v] of Object.entries(props)) {
		if (k === 'stack' || k === 'message' || k === 'detail' || k === 'kind') continue;
		if (Object.keys(extra).length >= 20) break;
		extra[k] = typeof v === 'string' ? scrubText(v, 200) : v;
	}

	const breadcrumbs: ErrorBreadcrumb[] = (event.breadcrumbs ?? [])
		.slice(-12)
		.map((b) => ({
			at: safeIsoFromMs(b.timestamp_ms, nowMs),
			kind: safeBreadcrumbKind(b.category),
			message: scrubText(b.level && b.level !== 'info' ? `[${b.level}] ${b.message}` : b.message, 160),
		}))
		.filter((b) => b.message.length > 0);

	const videoId = typeof props.video_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(props.video_id) ? props.video_id : undefined;

	return scrubEvent({
		app: errorApp,
		kind,
		ref: errorRefFromDigest(`telemetry:${event.id}`),
		name: rawName.slice(0, 120),
		message: rawMessage,
		stack,
		release: app.app_version ? app.app_version.slice(0, 80) : undefined,
		environment,
		locale: app.locale ? app.locale.slice(0, 24) : undefined,
		occurredAt: safeIsoFromMs(occurredMs, nowMs),
		extra,
		context: breadcrumbs.length || videoId ? { ...(videoId ? { videoId } : {}), ...(breadcrumbs.length ? { breadcrumbs } : {}) } : undefined,
	});
}

/** Splits forwarded error events into batches within admin-api's 20-event and 64 KB limits. */
export function chunkErrorEvents(events: ErrorEventInput[], maxEvents = ERROR_LIMITS.maxEventsPerBatch, maxBytes = FORWARD_MAX_BODY_BYTES): ErrorEventInput[][] {
	return chunkBySize(events, maxEvents, maxBytes, 16);
}

/** Splits any JSON-serializable event list into chunks bounded by item count and UTF-8 byte budget. */
export function chunkBySize<T>(items: T[], maxItems: number, maxBytes: number, envelopeBytes = 256): T[][] {
	const chunks: T[][] = [];
	const encoder = new TextEncoder();
	let current: T[] = [];
	let currentBytes = envelopeBytes;
	for (const item of items) {
		const itemBytes = encoder.encode(JSON.stringify(item)).byteLength + 1;
		if (current.length > 0 && (current.length >= maxItems || currentBytes + itemBytes > maxBytes)) {
			chunks.push(current);
			current = [];
			currentBytes = envelopeBytes;
		}
		current.push(item);
		currentBytes += itemBytes;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

async function resolveSecret(binding: { get?(): Promise<string>; text?(): Promise<string> } | string | undefined): Promise<string> {
	if (!binding) return '';
	if (typeof binding === 'string') return binding;
	try {
		if (typeof binding.get === 'function') return (await binding.get()) || '';
		if (typeof binding.text === 'function') return (await binding.text()) || '';
	} catch {
		return '';
	}
	return '';
}

async function hashCallerKey(raw: string, secret: string): Promise<string> {
	const data = new TextEncoder().encode(`${secret}:telemetry:${raw}`);
	const digest = await crypto.subtle.digest('SHA-256', data);
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return `tel_${hex.slice(0, 24)}`;
}

/**
 * Atomically claims unseen (or expired) event IDs in `SEARCH_DB.telemetry_dedupe` as short-lived
 * `pending` leases tied to `claimToken`. Unclaimed IDs are inspected so already-`delivered` events
 * are deduplicated while still-`pending` concurrent deliveries are reported in `pendingIds` (so the
 * caller receives a retryable 503 instead of a premature 202).
 */
export async function claimFreshEvents(
	db: D1Database | undefined,
	events: TelemetryEventInput[],
	nowMs = Date.now(),
	claimToken = crypto.randomUUID(),
): Promise<{ fresh: TelemetryEventInput[]; claimedIds: string[]; pendingIds: string[]; claimToken: string }> {
	// Always deduplicate within the batch first
	const unique: TelemetryEventInput[] = [];
	const seen = new Set<string>();
	for (const ev of events) {
		if (seen.has(ev.id)) continue;
		seen.add(ev.id);
		unique.push(ev);
	}
	if (!db || unique.length === 0) {
		return { fresh: unique, claimedIds: [], pendingIds: [], claimToken };
	}
	const pendingExpiresAt = nowMs + TELEMETRY_PENDING_TTL_MS;
	const stmts = unique.map((ev) =>
		db
			.prepare(
				`INSERT INTO telemetry_dedupe (event_id, status, claim_token, expires_at) VALUES (?, 'pending', ?, ?)
				 ON CONFLICT(event_id) DO UPDATE SET status = 'pending', claim_token = excluded.claim_token, expires_at = excluded.expires_at
				 WHERE telemetry_dedupe.expires_at <= ?`,
			)
			.bind(ev.id, claimToken, pendingExpiresAt, nowMs),
	);
	const results = await db.batch(stmts);
	const fresh: TelemetryEventInput[] = [];
	const claimedIds: string[] = [];
	const unclaimedIds: string[] = [];
	for (let i = 0; i < unique.length; i++) {
		const changes = (results[i]?.meta as { changes?: number } | undefined)?.changes ?? 0;
		if (changes > 0) {
			fresh.push(unique[i]);
			claimedIds.push(unique[i].id);
		} else {
			unclaimedIds.push(unique[i].id);
		}
	}

	const pendingIds: string[] = [];
	if (unclaimedIds.length > 0) {
		const deliveredSet = new Set<string>();
		const chunkSize = 49;
		for (let i = 0; i < unclaimedIds.length; i += chunkSize) {
			const part = unclaimedIds.slice(i, i + chunkSize);
			const res = await db
				.prepare(
					`SELECT event_id FROM telemetry_dedupe
					 WHERE status = 'delivered' AND expires_at > ? AND event_id IN (${part.map(() => '?').join(',')})`,
				)
				.bind(nowMs, ...part)
				.all<{ event_id: string }>();
			for (const row of res.results ?? []) {
				deliveredSet.add(row.event_id);
			}
		}
		for (const id of unclaimedIds) {
			if (!deliveredSet.has(id)) {
				pendingIds.push(id);
			}
		}
	}
	return { fresh, claimedIds, pendingIds, claimToken };
}

/** Promotes successfully delivered pending claims (owned by `claimToken`) to `delivered` for 24h. */
export async function markEventsDelivered(
	db: D1Database | undefined,
	ids: string[],
	claimToken: string,
	nowMs = Date.now(),
): Promise<void> {
	if (!db || ids.length === 0) return;
	const expiresAt = nowMs + TELEMETRY_DEDUPE_TTL_MS;
	const chunkSize = 48;
	const stmts: D1PreparedStatement[] = [];
	for (let i = 0; i < ids.length; i += chunkSize) {
		const part = ids.slice(i, i + chunkSize);
		stmts.push(
			db
				.prepare(
					`UPDATE telemetry_dedupe SET status = 'delivered', expires_at = ?
					 WHERE claim_token = ? AND event_id IN (${part.map(() => '?').join(',')})`,
				)
				.bind(expiresAt, claimToken, ...part),
		);
	}
	await db.batch(stmts);
}

/** Releases only pending claims owned by `claimToken` when a downstream failure asks the client to retry. */
export async function releaseClaimedIds(db: D1Database | undefined, ids: string[], claimToken: string): Promise<void> {
	if (!db || ids.length === 0) return;
	try {
		const chunkSize = 49;
		const stmts: D1PreparedStatement[] = [];
		for (let i = 0; i < ids.length; i += chunkSize) {
			const part = ids.slice(i, i + chunkSize);
			stmts.push(
				db
					.prepare(
						`DELETE FROM telemetry_dedupe
						 WHERE status = 'pending' AND claim_token = ? AND event_id IN (${part.map(() => '?').join(',')})`,
					)
					.bind(claimToken, ...part),
			);
		}
		await db.batch(stmts);
	} catch (error) {
		logger.warn('[Telemetry] Could not release dedupe claims after transient failure', {
			count: ids.length,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Daily cron cleanup for expired event-ID dedupe rows. */
export async function pruneTelemetryDedupe(db: D1Database, nowMs = Date.now()): Promise<number> {
	const res = await db.prepare('DELETE FROM telemetry_dedupe WHERE expires_at < ?').bind(nowMs).run();
	return (res.meta as { changes?: number } | undefined)?.changes ?? 0;
}

/**
 * POST /api/telemetry/batches
 * Native app telemetry & crash batch ingest (AlUmmahNowCore#8).
 */
export class TelemetryBatchesCreate extends OptionalAuthRoute {
	schema = {
		tags: ['Analytics'],
		summary: 'Ingest native app telemetry and crash batches',
		description:
			'🔓 Authentication optional. Accepts an `aun_telemetry::TelemetryBatch` (max 256 KiB request body, max 100 events, max 64 KiB serialized JSON per event, max 50 breadcrumbs, max 50 flat primitive properties with 1-64 char keys), deduplicates delivered events by event id for 24h, queues analytics/QoE events, and forwards error/crash reports to admin-api.',
		request: {
			body: { content: { 'application/json': { schema: TelemetryBatchBody } } },
		},
		responses: {
			'202': {
				description: 'Accepted',
				content: {
					'application/json': {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								accepted: z.number(),
								deduplicated: z.number(),
							}),
						}),
					},
				},
			},
			'400': {
				description: 'Invalid telemetry batch',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string(), error: z.string() }) } },
			},
			'413': {
				description: 'Batch exceeds 256 KiB limit',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string(), error: z.string() }) } },
			},
			'429': {
				description: 'Rate limited',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string(), error: z.string() }) } },
			},
			'503': {
				description: 'Telemetry delivery temporarily unavailable',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string(), error: z.string() }) } },
			},
		},
	};

	async handle(c: AppContext) {
		const rawText = await readBoundedText(c.req.raw, TELEMETRY_MAX_BODY_BYTES);
		if (rawText === null) {
			return apiError(c, 413, 'payload_too_large', { error: 'Telemetry batch exceeds the 256 KB limit' });
		}
		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(rawText);
		} catch {
			return apiError(c, 400, 'invalid_request', { error: 'A JSON object is required' });
		}
		const parsed = TelemetryBatchBody.safeParse(parsedJson);
		if (!parsed.success) {
			return apiError(c, 400, 'invalid_request', { error: 'Invalid telemetry batch' });
		}
		const batch = parsed.data;
		const secret = await resolveSecret(c.env.INTERNAL_API_KEY);
		if (!secret) {
			logger.error('[Telemetry] INTERNAL_API_KEY secret is unavailable');
			return apiError(c, 503, 'service_unavailable', { error: 'Telemetry ingest temporarily unavailable' }, { 'Retry-After': '30' });
		}
		const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
		const callerIdentity = this.getUserId(c) ?? ip;
		const rateKey = await hashCallerKey(callerIdentity, secret);

		let leaseId: string | undefined;
		if (c.env.SEARCH_DB) {
			const rl = await checkRateLimit(c.env.SEARCH_DB, rateKey, 'telemetry_batch', TELEMETRY_RATE_LIMIT);
			if (!rl.allowed) {
				if (rl.unavailable) {
					return apiError(c, 503, 'service_unavailable', { error: 'Telemetry ingest temporarily unavailable' }, { 'Retry-After': String(rl.retryAfter ?? 30) });
				}
				return apiError(c, 429, 'rate_limited', { error: 'Too many telemetry batches; try again later' }, { 'Retry-After': String(rl.retryAfter ?? 60) });
			}
			leaseId = rl.leaseId;
		}

		try {
			const nowMs = Date.now();
			const { fresh, claimedIds, pendingIds, claimToken } = await claimFreshEvents(c.env.SEARCH_DB, batch.events, nowMs);
			const deduplicated = batch.events.length - fresh.length - pendingIds.length;
			if (fresh.length === 0) {
				if (pendingIds.length > 0) {
					return apiError(c, 503, 'service_unavailable', { error: 'Telemetry events are still being processed; retry shortly' }, { 'Retry-After': '5' });
				}
				return c.json({ success: true, result: { accepted: 0, deduplicated } }, 202);
			}

			const analyticsEvents = fresh.filter((e) => e.kind === 'analytics' || e.kind === 'qoe');
			const rawErrorEvents = fresh.filter((e) => e.kind === 'error' || e.kind === 'crash');
			const errorEntries = rawErrorEvents
				.map((e) => ({ id: e.id, input: telemetryEventToErrorInput(e, batch.app, c.env.ENVIRONMENT || 'development', nowMs) }))
				.filter((entry): entry is { id: string; input: ErrorEventInput } => entry.input !== null);

			const deliveredIds = new Set<string>();
			try {
				if (analyticsEvents.length > 0) {
					if (!c.env.queue) {
						throw new Error('Telemetry analytics queue binding is unavailable');
					}
					const mappedAnalytics = analyticsEvents.map((e) => ({
						id: e.id,
						kind: e.kind,
						name: e.name,
						timestampMs: e.timestamp_ms,
						sessionId: e.session_id,
						properties: e.properties,
					}));
					const analyticsChunks = chunkBySize(mappedAnalytics, TELEMETRY_MAX_EVENTS, QUEUE_MAX_BODY_BYTES, 1024);
					const receivedAt = new Date(nowMs).toISOString();
					const appMeta = {
						platform: batch.app.platform,
						appVersion: batch.app.app_version,
						osVersion: batch.app.os_version,
						deviceClass: batch.app.device_class,
						locale: batch.app.locale,
						coreVersion: batch.app.core_version,
					};
					for (const chunk of analyticsChunks) {
						await c.env.queue.send({
							id: crypto.randomUUID(),
							type: MessageType.ClientAnalyticsEvent,
							payload: {
								kind: 'native_telemetry',
								batchId: batch.batch_id,
								app: appMeta,
								events: chunk,
								receivedAt,
							},
							timestamp: nowMs,
						});
						const chunkIds = chunk.map((ev) => ev.id);
						for (const id of chunkIds) deliveredIds.add(id);
						await markEventsDelivered(c.env.SEARCH_DB, chunkIds, claimToken, nowMs);
					}
				}

				if (errorEntries.length > 0) {
					if (!c.env.ERRORS_INGEST_URL) {
						throw new Error('ERRORS_INGEST_URL is not configured');
					}
					const errorChunks = chunkBySize(errorEntries, ERROR_LIMITS.maxEventsPerBatch, FORWARD_MAX_BODY_BYTES, 16);
					const ua = c.req.header('User-Agent')?.slice(0, 256);
					for (const chunk of errorChunks) {
						const res = await fetch(c.env.ERRORS_INGEST_URL, {
							method: 'POST',
							redirect: 'error',
							headers: {
								'Content-Type': 'application/json',
								'X-API-Key': secret,
								...(ua ? { 'X-Client-User-Agent': ua } : {}),
							},
							body: JSON.stringify({ events: chunk.map((entry) => entry.input) }),
						});
						if (!res.ok) {
							throw new Error(`admin-api errors ingest returned ${res.status}`);
						}
						const chunkIds = chunk.map((entry) => entry.id);
						for (const id of chunkIds) deliveredIds.add(id);
						await markEventsDelivered(c.env.SEARCH_DB, chunkIds, claimToken, nowMs);
					}
				}

				// If any error event failed scrubbing unexpectedly, release its pending claim rather than counting it delivered
				if (errorEntries.length < rawErrorEvents.length) {
					const dropped = rawErrorEvents.map((e) => e.id).filter((id) => !deliveredIds.has(id));
					await releaseClaimedIds(c.env.SEARCH_DB, dropped, claimToken);
				}
			} catch (error) {
				const undelivered = claimedIds.filter((id) => !deliveredIds.has(id));
				await releaseClaimedIds(c.env.SEARCH_DB, undelivered, claimToken);
				logger.error('[Telemetry] Failed to deliver telemetry batch', {
					batchId: batch.batch_id,
					count: fresh.length,
					undelivered: undelivered.length,
					error: error instanceof Error ? error.message : String(error),
				});
				return apiError(c, 503, 'service_unavailable', { error: 'Telemetry delivery temporarily unavailable; retry shortly' }, { 'Retry-After': '30' });
			}

			if (pendingIds.length > 0) {
				return apiError(c, 503, 'service_unavailable', { error: 'Telemetry events are still being processed; retry shortly' }, { 'Retry-After': '5' });
			}

			return c.json({ success: true, result: { accepted: deliveredIds.size, deduplicated } }, 202);
		} finally {
			if (c.env.SEARCH_DB && leaseId) {
				await releaseRateLimit(c.env.SEARCH_DB, rateKey, 'telemetry_batch', leaseId);
			}
		}
	}
}
