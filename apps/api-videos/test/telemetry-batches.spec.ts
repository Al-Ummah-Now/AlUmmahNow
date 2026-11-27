/**
 * Native app telemetry & crash batch ingest (AlUmmahNowCore#8 / Epic 9.8):
 * - Routes `analytics` / `qoe` events to `MessageType.ClientAnalyticsEvent` (`kind: 'native_telemetry'`)
 * - Routes `error` / `crash` events (with breadcrumbs & stack) to `ERRORS_INGEST_URL` with
 *   deterministic `ERR-XXXX-XXXX` references and chunking within admin-api limits
 * - Deduplicates by event id within a batch and across retries, releasing claims on transient 503
 * - Enforces 256 KB streaming body cap (413), schema validation (400), and hashed per-caller rate limits (429)
 * - Prunes expired dedupe rows via `pruneTelemetryDedupe`
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { errorRefFromDigest } from '@al-ummah/shared-types';
import {
	TELEMETRY_MAX_BODY_BYTES,
	TELEMETRY_RATE_LIMIT,
	TelemetryBatchesCreate,
	chunkErrorEvents,
	mapTelemetryPlatformToErrorApp,
	pruneTelemetryDedupe,
	telemetryEventToErrorInput,
} from '../src/endpoints/analytics/telemetryBatches';
import { buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const NOW_MS = Date.UTC(2026, 10, 27, 5, 0, 0);

function makeBatch(overrides: Record<string, unknown> = {}) {
	return {
		batch_id: 'batch_0001',
		sent_at_ms: NOW_MS,
		app: {
			platform: 'ios',
			app_version: '1.4.2',
			os_version: '18.2',
			device_class: 'phone',
			locale: 'ar',
			core_version: '0.4.0-rc.12',
		},
		events: [
			{
				id: 'evt_analytics_01',
				kind: 'analytics',
				name: 'screen_view',
				timestamp_ms: NOW_MS - 1000,
				session_id: 'sess_1',
				properties: { screen: 'home', tab: 'featured' },
			},
			{
				id: 'evt_qoe_01',
				kind: 'qoe',
				name: 'qoe_summary',
				timestamp_ms: NOW_MS - 500,
				session_id: 'sess_1',
				properties: { video_id: 'vid_123', startup_time_ms: 420, rebuffer_count: 0 },
			},
			{
				id: 'evt_crash_01',
				kind: 'crash',
				name: 'crash',
				timestamp_ms: NOW_MS - 200,
				session_id: 'sess_1',
				properties: {
					kind: 'NSInvalidArgumentException',
					message: 'Unrecognized selector sent to player for user@example.com',
					stack: '0 CoreFoundation 0x100\n1 AlUmmahNow 0x200',
					occurred_at_ms: NOW_MS - 300,
					from_previous_session: true,
				},
				breadcrumbs: [
					{ timestamp_ms: NOW_MS - 2000, category: 'navigation', message: 'Opened /watch/vid_123', level: 'info' },
					{ timestamp_ms: NOW_MS - 1000, category: 'player', message: 'Buffer stall', level: 'warning' },
				],
			},
		],
		...overrides,
	};
}

describe('POST /api/telemetry/batches (AlUmmahNowCore#8)', () => {
	const originalFetch = globalThis.fetch;
	let searchDb: SqliteD1;
	let queued: unknown[];
	let forwarded: { url: string; headers: Headers; body: { events: any[] } }[];
	let forwardStatus: number;

	beforeEach(() => {
		searchDb = new SqliteD1();
		queued = [];
		forwarded = [];
		forwardStatus = 202;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url === 'https://admin.api.test/internal/errors') {
				const body = JSON.parse(String(init?.body ?? '{}')) as { events: any[] };
				forwarded.push({ url, headers: new Headers(init?.headers), body });
				return new Response(JSON.stringify({ success: forwardStatus < 400 }), { status: forwardStatus });
			}
			return new Response('not found', { status: 404 });
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function createEnv() {
		return {
			SEARCH_DB: searchDb as unknown as D1Database,
			ENVIRONMENT: 'production',
			INTERNAL_API_KEY: 'internal-secret-key',
			ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors',
			queue: {
				async send(msg: unknown) {
					queued.push(msg);
				},
			},
		};
	}

	function createApp() {
		return buildApp((r: any) => {
			r.post('/api/telemetry/batches', TelemetryBatchesCreate);
		});
	}

	it('maps native platforms cleanly to ERROR_APPS', () => {
		assert.equal(mapTelemetryPlatformToErrorApp('ios'), 'ios');
		assert.equal(mapTelemetryPlatformToErrorApp('iPadOS'), 'ios');
		assert.equal(mapTelemetryPlatformToErrorApp('macos'), 'macos');
		assert.equal(mapTelemetryPlatformToErrorApp('tvos'), 'tvos');
		assert.equal(mapTelemetryPlatformToErrorApp('android'), 'android');
		assert.equal(mapTelemetryPlatformToErrorApp('windows'), 'desktop');
		assert.equal(mapTelemetryPlatformToErrorApp('linux'), 'desktop');
	});

	it('queues analytics/qoe, forwards scrubbed crash/error events with deterministic refs, and deduplicates retries', async () => {
		const app = createApp();
		const env = createEnv();
		const batch = makeBatch();

		const res1 = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.10', 'User-Agent': 'AlUmmahNow-iOS/1.4.2' },
				body: JSON.stringify(batch),
			},
			env as any,
		);
		assert.equal(res1.status, 202);
		assert.deepEqual(await res1.json(), { success: true, result: { accepted: 3, deduplicated: 0 } });

		// Analytics + QoE queued as ClientAnalyticsEvent
		assert.equal(queued.length, 1);
		const qMsg = queued[0] as { payload: { kind: string; events: any[]; app: { platform: string } } };
		assert.equal(qMsg.payload.kind, 'native_telemetry');
		assert.equal(qMsg.payload.app.platform, 'ios');
		assert.equal(qMsg.payload.events.length, 2);

		// Crash forwarded to admin-api /internal/errors with scrubbed message, stack, breadcrumbs, deterministic ref
		assert.equal(forwarded.length, 1);
		assert.equal(forwarded[0].headers.get('x-api-key'), 'internal-secret-key');
		assert.equal(forwarded[0].body.events.length, 1);
		const ev = forwarded[0].body.events[0];
		assert.equal(ev.app, 'ios');
		assert.equal(ev.kind, 'crash');
		assert.equal(ev.ref, errorRefFromDigest('telemetry:evt_crash_01'));
		assert.equal(ev.name, 'NSInvalidArgumentException');
		assert.ok(!ev.message.includes('user@example.com'));
		assert.ok(ev.message.includes('[email]'));
		assert.ok(ev.stack.includes('AlUmmahNow'));
		assert.equal(ev.release, '1.4.2');
		assert.equal(ev.context.breadcrumbs.length, 2);
		assert.equal(ev.context.breadcrumbs[0].kind, 'navigation');

		// Raw IP must never be stored in upload_rate_windows
		const rateRows = searchDb.db.prepare('SELECT user_id FROM upload_rate_windows').all() as { user_id: string }[];
		assert.ok(rateRows.length > 0);
		assert.ok(rateRows.every((r) => !r.user_id.includes('198.51.100.10') && r.user_id.startsWith('tel_')));

		// Retry of the exact same batch is deduplicated cleanly
		const res2 = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.10' },
				body: JSON.stringify(batch),
			},
			env as any,
		);
		assert.equal(res2.status, 202);
		assert.deepEqual(await res2.json(), { success: true, result: { accepted: 0, deduplicated: 3 } });
		assert.equal(queued.length, 1);
		assert.equal(forwarded.length, 1);
	});

	it('rolls back only undelivered dedupe claims on partial 503 failure so retry delivers without duplicating', async () => {
		const app = createApp();
		const env = createEnv();
		const batch = makeBatch({
			events: [
				{
					id: 'evt_partial_analytics',
					kind: 'analytics',
					name: 'screen_view',
					timestamp_ms: NOW_MS,
					session_id: 'sess_r',
					properties: { screen: 'home' },
				},
				{
					id: 'evt_retry_crash',
					kind: 'crash',
					name: 'crash',
					timestamp_ms: NOW_MS,
					session_id: 'sess_r',
					properties: { kind: 'SIGSEGV', message: 'segfault' },
				},
			],
		});

		forwardStatus = 503;
		const failed = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' }, body: JSON.stringify(batch) },
			env as any,
		);
		assert.equal(failed.status, 503);
		assert.equal(failed.headers.get('retry-after'), '30');
		assert.equal(queued.length, 1);

		// Retry once admin-api recovers: analytics was already delivered (deduplicated), crash is retried & accepted!
		forwardStatus = 202;
		const retried = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.11' }, body: JSON.stringify(batch) },
			env as any,
		);
		assert.equal(retried.status, 202);
		assert.deepEqual(await retried.json(), { success: true, result: { accepted: 1, deduplicated: 1 } });
		assert.equal(queued.length, 1);
		assert.equal(forwarded.length, 2);
	});

	it('rejects oversized bodies (413), malformed payloads (400), and enforces rate limits (429)', async () => {
		const app = createApp();
		const env = createEnv();

		const big = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.12' },
				body: JSON.stringify({ pad: 'x'.repeat(TELEMETRY_MAX_BODY_BYTES + 100) }),
			},
			env as any,
		);
		assert.equal(big.status, 413);

		const bad = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.12' },
				body: JSON.stringify({ batch_id: 'b1', sent_at_ms: NOW_MS, app: { platform: 'ios' }, events: [] }),
			},
			env as any,
		);
		assert.equal(bad.status, 400);

		// Exhaust per-minute rate limit for one IP
		for (let i = 0; i < TELEMETRY_RATE_LIMIT.perMinute; i++) {
			const r = await app.request(
				'/api/telemetry/batches',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.99' },
					body: JSON.stringify(makeBatch({ events: [{ id: `rl_${i}`, kind: 'analytics', name: 'tap', timestamp_ms: NOW_MS, session_id: 's' }] })),
				},
				env as any,
			);
			assert.equal(r.status, 202);
		}
		const limited = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.99' },
				body: JSON.stringify(makeBatch({ events: [{ id: 'rl_over', kind: 'analytics', name: 'tap', timestamp_ms: NOW_MS, session_id: 's' }] })),
			},
			env as any,
		);
		assert.equal(limited.status, 429);
		assert.ok(Number(limited.headers.get('retry-after')) >= 1);
	});

	it('chunks large error batches under admin-api limits and prunes expired dedupe rows', async () => {
		const events = Array.from({ length: 25 }, (_, i) =>
			telemetryEventToErrorInput(
				{
					id: `chunk_${i}`,
					kind: 'error',
					name: 'playback_error',
					timestamp_ms: NOW_MS,
					session_id: 's',
					properties: { code: 'decode', video_id: 'vid_9', fatal: true, detail: `err ${i}` },
					breadcrumbs: [],
				},
				{ platform: 'android', app_version: '1.0.0', os_version: '15', device_class: 'phone', locale: 'en', core_version: '0.4.0' },
				'production',
				NOW_MS,
			)!,
		);
		const chunks = chunkErrorEvents(events);
		assert.equal(chunks.length, 2);
		assert.equal(chunks[0].length, 20);
		assert.equal(chunks[1].length, 5);
		assert.equal(chunks[0][0].app, 'android');
		assert.equal(chunks[0][0].kind, 'player');

		// Prune expired dedupe rows
		searchDb.db.prepare('INSERT INTO telemetry_dedupe (event_id, expires_at) VALUES (?, ?), (?, ?)').run('old_ev', NOW_MS - 1000, 'new_ev', NOW_MS + 60_000);
		const removed = await pruneTelemetryDedupe(searchDb as unknown as D1Database, NOW_MS);
		assert.equal(removed, 1);
		const remaining = searchDb.db.prepare('SELECT event_id FROM telemetry_dedupe').all() as { event_id: string }[];
		assert.deepEqual(
			remaining.map((r) => r.event_id),
			['new_ev'],
		);
	});

	it('rejects chunked oversized streams without Content-Length (413), oversized single events (400), and chunks large analytics batches for Queues', async () => {
		const app = createApp();
		const env = createEnv();

		// 1. Streaming > 256 KB without Content-Length header
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const chunk = new Uint8Array(64 * 1024).fill(0x20);
				for (let i = 0; i < 5; i++) controller.enqueue(chunk);
				controller.close();
			},
		});
		const streamedRes = await app.request(
			new Request('https://videos.api.test/api/telemetry/batches', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.13' },
				body: stream,
				duplex: 'half',
			} as RequestInit),
			env as any,
		);
		assert.equal(streamedRes.status, 413);

		// 2. Single event exceeding 64 KB per-event cap inside a < 256 KB batch -> 400
		const hugeProps: Record<string, string> = {};
		for (let i = 0; i < 6; i++) hugeProps[`k${i}`] = 'a'.repeat(12_000);
		const oversizedEvRes = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.13' },
				body: JSON.stringify(
					makeBatch({
						events: [{ id: 'evt_huge_single', kind: 'analytics', name: 'big', timestamp_ms: NOW_MS, session_id: 's', properties: hugeProps }],
					}),
				),
			},
			env as any,
		);
		assert.equal(oversizedEvRes.status, 400);

		// 3. Multiple medium analytics events totaling ~120 KB get split across >= 2 queue messages (each < 128 KB)
		const mediumEvents = Array.from({ length: 10 }, (_, i) => ({
			id: `evt_med_${i}`,
			kind: 'analytics',
			name: 'screen_view',
			timestamp_ms: NOW_MS,
			session_id: 's',
			properties: { payload: 'b'.repeat(12_000) },
		}));
		const splitRes = await app.request(
			'/api/telemetry/batches',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.13' },
				body: JSON.stringify(makeBatch({ events: mediumEvents })),
			},
			env as any,
		);
		assert.equal(splitRes.status, 202);
		assert.ok(queued.length >= 2, `expected >= 2 queue messages, got ${queued.length}`);
		for (const msg of queued) {
			assert.ok(new TextEncoder().encode(JSON.stringify(msg)).byteLength < 128 * 1024);
		}
	});
});
