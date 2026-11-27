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
	claimFreshEvents,
	mapTelemetryPlatformToErrorApp,
	pruneTelemetryDedupe,
	releaseClaimedIds,
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
	let forwarded: { url: string; headers: Headers; redirect?: RequestRedirect; body: { events: any[] } }[];
	let forwardStatus: number;

	beforeEach(() => {
		searchDb = new SqliteD1();
		queued = [];
		forwarded = [];
		forwardStatus = 202;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url === 'https://admin.api.test/internal/errors') {
				if (forwardStatus >= 300 && forwardStatus < 400 && init?.redirect === 'error') {
					throw new TypeError(`fetch failed: unexpected redirect (${forwardStatus})`);
				}
				const body = JSON.parse(String(init?.body ?? '{}')) as { events: any[] };
				forwarded.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect, body });
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
		assert.equal(forwarded[0].redirect, 'error');
		assert.equal(forwarded[0].headers.get('x-api-key'), 'internal-secret-key');
		assert.equal(forwarded[0].headers.get('x-client-ip'), null);
		assert.equal(forwarded[0].headers.get('x-report-source'), null);
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
		const streamedRes = await app.fetch(
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

	it('returns 503 (never premature 202) on concurrent in-flight retry, and guards rollback with claim_token', async () => {
		const app = createApp();
		const env = createEnv();
		const batch = makeBatch({
			events: [
				{
					id: 'evt_inflight_01',
					kind: 'crash',
					name: 'crash',
					timestamp_ms: NOW_MS,
					session_id: 'sess_race',
					properties: { kind: 'EXC_BAD_ACCESS', message: 'boom' },
				},
			],
		});

		// Pause the first request while it is forwarding to admin-api
		let releaseFirst!: () => void;
		let firstEntered!: () => void;
		const enteredPromise = new Promise<void>((r) => {
			firstEntered = r;
		});
		const gatePromise = new Promise<void>((r) => {
			releaseFirst = r;
		});

		let callCount = 0;
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			callCount += 1;
			if (callCount === 1) {
				firstEntered();
				await gatePromise;
				return new Response(JSON.stringify({ success: false }), { status: 503 });
			}
			const body = JSON.parse(String(init?.body ?? '{}')) as { events: any[] };
			forwarded.push({ url: 'https://admin.api.test/internal/errors', headers: new Headers(init?.headers), body });
			return new Response(JSON.stringify({ success: true }), { status: 202 });
		}) as typeof fetch;

		const req1Promise = app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify(batch) },
			env as any,
		);
		await enteredPromise;

		// Concurrent retry while req1 is still forwarding: MUST get 503 Retry-After: 5, NOT 202!
		const concurrentRes = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify(batch) },
			env as any,
		);
		assert.equal(concurrentRes.status, 503);
		assert.equal(concurrentRes.headers.get('retry-after'), '5');

		// First request finishes with downstream 503 and releases its pending claim
		releaseFirst();
		const req1Res = await req1Promise;
		assert.equal(req1Res.status, 503);

		// Subsequent retry delivers cleanly and promotes the row to 'delivered'
		const retryRes = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify(batch) },
			env as any,
		);
		assert.equal(retryRes.status, 202);
		assert.deepEqual(await retryRes.json(), { success: true, result: { accepted: 1, deduplicated: 0 } });
		assert.equal(forwarded.length, 1);

		// Stale claim_token cannot delete a newer claim
		const claimA = await claimFreshEvents(
			searchDb as unknown as D1Database,
			[{ id: 'evt_token_guard', kind: 'analytics', name: 'tap', timestamp_ms: NOW_MS, session_id: 's', properties: {}, breadcrumbs: [] }],
			NOW_MS,
			'token_A',
		);
		assert.equal(claimA.fresh.length, 1);
		// Reclaim after pending lease expires
		const claimB = await claimFreshEvents(
			searchDb as unknown as D1Database,
			[{ id: 'evt_token_guard', kind: 'analytics', name: 'tap', timestamp_ms: NOW_MS, session_id: 's', properties: {}, breadcrumbs: [] }],
			NOW_MS + 120_000,
			'token_B',
		);
		assert.equal(claimB.fresh.length, 1);
		await releaseClaimedIds(searchDb as unknown as D1Database, ['evt_token_guard'], 'token_A');
		const row = searchDb.db.prepare('SELECT claim_token FROM telemetry_dedupe WHERE event_id = ?').get('evt_token_guard') as { claim_token: string } | undefined;
		assert.equal(row?.claim_token, 'token_B');
	});

	it('fails closed on missing secret, missing sink config, and admin-api 401/403 without writing rate-limit or dedupe state', async () => {
		const app = createApp();

		// 1. Missing INTERNAL_API_KEY fails closed with 503 before hashing/writing rate limits
		const noSecretEnv = { ...createEnv(), INTERNAL_API_KEY: '' };
		const noSecretRes = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.30' }, body: JSON.stringify(makeBatch()) },
			noSecretEnv as any,
		);
		assert.equal(noSecretRes.status, 503);
		const rlRows = searchDb.db.prepare('SELECT COUNT(*) as c FROM upload_rate_windows').get() as { c: number };
		assert.equal(rlRows.c, 0);

		// 2. Missing ERRORS_INGEST_URL refuses to acknowledge crash events and releases pending claim
		const noUrlEnv = { ...createEnv(), ERRORS_INGEST_URL: '' };
		const crashBatch = makeBatch({
			events: [{ id: 'evt_no_url', kind: 'crash', name: 'crash', timestamp_ms: NOW_MS, session_id: 's', properties: { kind: 'ERR', message: 'm' } }],
		});
		const noUrlRes = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.31' }, body: JSON.stringify(crashBatch) },
			noUrlEnv as any,
		);
		assert.equal(noUrlRes.status, 503);
		const dedupeAfterNoUrl = searchDb.db.prepare('SELECT event_id FROM telemetry_dedupe WHERE event_id = ?').get('evt_no_url');
		assert.equal(dedupeAfterNoUrl, undefined);

		// 3. Downstream 303/401/403 from admin-api fails with 503 and releases pending claim (never returns 202)
		const env = createEnv();
		for (const status of [303, 401, 403]) {
			forwardStatus = status;
			const authFailRes = await app.request(
				'/api/telemetry/batches',
				{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.32' }, body: JSON.stringify(crashBatch) },
				env as any,
			);
			assert.equal(authFailRes.status, 503);
			assert.equal(searchDb.db.prepare('SELECT event_id FROM telemetry_dedupe WHERE event_id = ?').get('evt_no_url'), undefined);
		}
	});

	it('enforces Content-Length fast-path 413 and byte-based admin-api chunking under 20 events', async () => {
		const app = createApp();
		const env = createEnv();

		// 1. Oversized Content-Length header rejected immediately with 413 without reading stream
		let streamRead = false;
		const guardedStream = new ReadableStream<Uint8Array>(
			{
				pull() {
					streamRead = true;
				},
			},
			{ highWaterMark: 0 },
		);
		const fastPathReq = new Request('https://videos.api.test/api/telemetry/batches', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': String(TELEMETRY_MAX_BODY_BYTES + 1),
				'CF-Connecting-IP': '198.51.100.40',
			},
			body: guardedStream,
			duplex: 'half',
		} as RequestInit);
		const fastPathRes = await app.fetch(fastPathReq, env as any);
		assert.equal(fastPathRes.status, 413);
		assert.equal(streamRead, false);
		assert.equal(fastPathReq.bodyUsed, false);

		// 2. Byte-based admin-api chunking: 10 large crash events (< 20 count, > 58 KB scrubbed) split into >= 2 chunks
		const extraProps: Record<string, string> = {};
		for (let p = 0; p < 7; p++) extraProps[`meta_${p}`] = 'detail value '.repeat(14).trim();
		const bigCrashEvents = Array.from({ length: 10 }, (_, i) => ({
			id: `byte_chunk_${i}`,
			kind: 'crash' as const,
			name: 'crash',
			timestamp_ms: NOW_MS,
			session_id: 's',
			properties: {
				kind: 'NativeCrash',
				message: `crash ${i}: ` + 'unexpected player state transition '.repeat(24).trim(),
				stack: Array.from({ length: 50 }, (_, f) => `${f} AlUmmahNow 0x${(i * 1000 + f).toString(16)} PlayerViewController.renderFrame(at line ${f}) in module playback`).join('\n'),
				...extraProps,
			},
			breadcrumbs: Array.from({ length: 12 }, (_, b) => ({
				timestamp_ms: NOW_MS - b * 100,
				category: 'player',
				message: `step ${b}: ` + 'playback state updated '.repeat(5).trim(),
				level: 'info' as const,
			})),
		}));
		const bigCrashes = bigCrashEvents.map((ev) =>
			telemetryEventToErrorInput(
				ev,
				{ platform: 'ios', app_version: '1.0.0', os_version: '18.2', device_class: 'phone', locale: 'en', core_version: '0.4.0' },
				'production',
				NOW_MS,
			)!,
		);
		const byteChunks = chunkErrorEvents(bigCrashes);
		assert.ok(byteChunks.length >= 2, `expected >= 2 byte-bounded chunks, got ${byteChunks.length}`);
		for (const chunk of byteChunks) {
			assert.ok(new TextEncoder().encode(JSON.stringify({ events: chunk })).byteLength <= 64 * 1024);
		}
		// End-to-end through POST /api/telemetry/batches: splits into >= 2 admin-api requests
		const e2eRes = await app.request(
			'/api/telemetry/batches',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.41' }, body: JSON.stringify(makeBatch({ events: bigCrashEvents })) },
			env as any,
		);
		assert.equal(e2eRes.status, 202);
		assert.ok(forwarded.length >= 2, `expected >= 2 admin-api POSTs, got ${forwarded.length}`);
		for (const req of forwarded) {
			assert.ok(new TextEncoder().encode(JSON.stringify(req.body)).byteLength <= 64 * 1024);
		}
	});
});
