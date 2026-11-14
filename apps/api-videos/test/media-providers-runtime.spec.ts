/**
 * Provider adapters, the health pass and the provider-settings routes (docs/media-delivery/PROVIDERS.md).
 * Network calls (probes, the Errors page ingest) go to a stubbed fetch; nothing leaves the process.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DEFAULT_MEDIA_SETTINGS } from '@al-ummah/shared-types';
import { allProviders, bunnyRef, provider, videoProviderRecords } from '../src/lib/media/providers';
import { clearHealthCache, countProviderFailure, HEALTH_KEY, readHealth, reporterKey, runHealthCheck } from '../src/lib/media/health';
import { clearMediaSettingsCache, readMediaSettings, saveMediaSettings, SETTINGS_KEY } from '../src/lib/media/settings';
import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const GUID = '0d6e7a1c-3b5f-4e8a-9c2d-1f4b6a8e0c3d';
const BUNNY_HOST = 'vz-cb79844a-c5d.b-cdn.net';
const MEDIA_HOST = 'media.qa.alummahnow.net';
const READY = { status: 'ready', jobId: 'j', rev: 'abcdefgh12345678', access: 'pub', attempts: 1, queuedAt: 'x' } as never;

type Call = { url: string; method: string; body?: unknown };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
/** Status the stubbed edge answers per host (default 200) */
let answers: Record<string, number | 'throw'> = {};

beforeEach(() => {
	calls = [];
	answers = {};
	clearHealthCache();
	clearMediaSettingsCache();
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ url, method: init?.method ?? 'GET', body });
		const answer = answers[new URL(url).host] ?? 200;
		if (answer === 'throw') throw new Error('connect timeout');
		return new Response(null, { status: answer });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function env(extra: Record<string, unknown> = {}) {
	return {
		global_settings: new MemoryBucket(),
		MEDIA: new MemoryBucket(),
		MEDIA_PUBLIC_HOST: MEDIA_HOST,
		MEDIA_SIGN_KEY: 'sign-key',
		bunny_hostname: BUNNY_HOST,
		SEARCH_DB: new SqliteD1(),
		ERRORS_INGEST_URL: 'https://admin.qa.api.alummahnow.net/internal/errors',
		INTERNAL_API_KEY: 'internal-key',
		...extra,
	};
}

const ctx = () => {
	const pending: Promise<unknown>[] = [];
	return { waitUntil: (p: Promise<unknown>) => void pending.push(p), done: () => Promise.all(pending) };
};

describe('adapters', () => {
	it('a legacy row is Bunny (ref = its id) plus R2 where R2 holds a copy', () => {
		const records = videoProviderRecords({ id: ID, uploadStatus: 'ready', r2: READY });
		assert.deepEqual(records.map((r) => [r.provider, r.ref, r.status, r.legacy ?? false]), [
			['bunny', ID, 'ready', true],
			['r2', ID, 'ready', true],
		]);
		assert.deepEqual(videoProviderRecords({ id: ID, uploadStatus: 'processing' }).map((r) => [r.provider, r.status]), [['bunny', 'processing']]);
	});

	it('a new video names its providers: Bunny under its own GUID, never our id', () => {
		const video = { id: ID, media: { providers: { bunny: { ref: GUID, status: 'ready' as const, addedAt: 'x' } } } };
		assert.equal(bunnyRef(video), GUID);
		assert.deepEqual(videoProviderRecords(video).map((r) => [r.provider, r.ref]), [['bunny', GUID]]);
		// R2-only: no Bunny record at all
		assert.equal(bunnyRef({ id: ID, media: { providers: { r2: { ref: ID, addedAt: 'x' } } } }), null);
	});

	it('Bunny playback signs the playlist and the frame under the GUID, at the pinned hour', async () => {
		const e = env({ BUNNY_SIGN_URLS: 'true', BUNNY_TOKEN_KEY: 'token-key' });
		const video = { id: ID, media: { providers: { bunny: { ref: GUID, status: 'ready' as const, addedAt: 'x' } } } };
		const record = provider('bunny').record(video)!;
		const a = await provider('bunny').playback(e as never, video, record, { nowSeconds: 1_794_480_000 });
		const b = await provider('bunny').playback(e as never, video, record, { nowSeconds: 1_794_480_000 + 1200 });
		assert.ok(a!.playUrl.startsWith(`https://${BUNNY_HOST}/bcdn_token=`), a!.playUrl);
		assert.ok(a!.playUrl.endsWith(`/${GUID}/playlist.m3u8`));
		assert.ok(a!.thumbnailUrl!.startsWith(`https://${BUNNY_HOST}/${GUID}/thumbnail.jpg?token=`));
		assert.deepEqual(a, b, 'the same URLs within the hour (cacheable)');
	});

	it('auto frames: each provider recognises only its own frame of this video; custom is never auto', () => {
		const video = { id: ID, r2: READY };
		const bunnyFrame = `https://${BUNNY_HOST}/${ID}/thumbnail_3.jpg`;
		const r2Frame = `https://${MEDIA_HOST}/pub/${ID}/abcdefgh12345678/thumb.jpg`;
		assert.equal(provider('bunny').isOwnAutoThumbnail(video, bunnyFrame), true);
		assert.equal(provider('bunny').isOwnAutoThumbnail(video, `https://${BUNNY_HOST}/${GUID}/thumbnail.jpg`), false, 'another video');
		assert.equal(provider('r2').isOwnAutoThumbnail(video, r2Frame), true);
		assert.equal(provider('r2').isOwnAutoThumbnail(video, 'https://images.alummahnow.net/imported/x.jpg'), false);
		assert.equal(provider('bunny').isOwnAutoThumbnail({ ...video, thumbnailType: 'custom' }, bunnyFrame), false);
	});

	it('the registry lists every adapter once, in MEDIA_PROVIDER_IDS order', () => {
		assert.deepEqual(allProviders().map((p) => p.id), ['bunny', 'r2']);
	});
});

describe('provider health', () => {
	it('player fallbacks are counted per provider, minute and reporter', async () => {
		const e = env();
		const now = Date.parse('2026-11-14T10:00:30Z');
		await countProviderFailure(e as never, 'r2', 'aaaa', now);
		await countProviderFailure(e as never, 'r2', 'aaaa', now + 10_000);
		await countProviderFailure(e as never, 'bunny', 'aaaa', now + 61_000);
		const rows = await e.SEARCH_DB.prepare('SELECT provider, minute, reporter, failures FROM media_provider_health ORDER BY provider').all();
		assert.deepEqual(rows.results.map((r) => ({ ...r })), [
			{ provider: 'bunny', minute: '2026-11-14T10:01', reporter: 'aaaa', failures: 1 },
			{ provider: 'r2', minute: '2026-11-14T10:00', reporter: 'aaaa', failures: 2 },
		]);
	});

	it('one client looping over videos counts once: the threshold needs distinct reporters', async () => {
		const e = env();
		const start = Date.parse('2026-11-14T10:00:00Z');
		for (let i = 0; i < 50; i++) await countProviderFailure(e as never, 'r2', 'one-client', start + i * 1000);
		const one = await runHealthCheck(e as never, undefined, new Date(start + 60_000));
		assert.equal(one!.providers.r2!.recentFailures, 1);
		assert.equal(one!.providers.r2!.state, 'healthy');
		for (let i = 0; i < 10; i++) await countProviderFailure(e as never, 'r2', `client-${i}`, start + 70_000);
		const many = await runHealthCheck(e as never, undefined, new Date(start + 120_000));
		assert.equal(many!.providers.r2!.state, 'unhealthy');
	});

	it('reporter keys: stable within a day, different across days and clients, never the raw IP', async () => {
		const day = Date.parse('2026-11-14T10:00:00Z');
		const a = await reporterKey('203.0.113.7', null, day);
		assert.equal(a, await reporterKey('203.0.113.7', null, day + 3600_000));
		assert.notEqual(a, await reporterKey('203.0.113.7', null, day + 86400_000));
		assert.notEqual(a, await reporterKey('203.0.113.8', null, day));
		assert.match(a, /^[0-9a-f]{16}$/);
	});

	it('a failing probe turns the provider unhealthy after probeFailures passes and flags the Errors page once', async () => {
		const e = env();
		answers[MEDIA_HOST] = 503;
		const start = Date.parse('2026-11-14T10:00:00Z');
		for (let i = 0; i < 3; i++) {
			const c = ctx();
			const snap = await runHealthCheck(e as never, c, new Date(start + i * 60_000));
			await c.done();
			assert.equal(snap!.providers.bunny!.state, 'healthy');
			assert.equal(snap!.providers.r2!.state, i < 2 ? 'healthy' : 'unhealthy', `pass ${i + 1}`);
		}
		const reports = calls.filter((c) => c.url.endsWith('/internal/errors'));
		assert.equal(reports.length, 1, 'one Errors page item');
		const item = JSON.stringify(reports[0]!.body);
		assert.match(item, /media-provider-health:r2/);
		assert.match(item, /\/internal\/media\/health\/check/);
		// The snapshot is stored for every isolate
		const stored = await (await e.global_settings.get(HEALTH_KEY))!.json<{ providers: Record<string, { state: string }> }>();
		assert.equal(stored.providers.r2!.state, 'unhealthy');

		// Recovery after the cooldown resolves the item
		answers[MEDIA_HOST] = 200;
		calls = [];
		const c = ctx();
		const later = await runHealthCheck(e as never, c, new Date(start + 30 * 60_000));
		await c.done();
		assert.equal(later!.providers.r2!.state, 'healthy');
		const resolved = calls.filter((x) => x.url.endsWith('/internal/errors'));
		assert.equal(resolved.length, 1);
		assert.match(JSON.stringify(resolved[0]!.body), /"resolved".*media-provider-health:r2/);
	});

	it('a provider switched off is not probed', async () => {
		const e = env();
		await saveMediaSettings(e as never, { ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: true }, r2: { enabled: false } }, ingest: ['bunny'] }, 'admin-1');
		const snap = await runHealthCheck(e as never, undefined, new Date());
		assert.deepEqual(Object.keys(snap!.providers), ['bunny']);
		assert.ok(!calls.some((c) => c.url.includes(MEDIA_HOST)));
	});

	it('the R2 canary is written only when the edge does not have it', async () => {
		const e = env();
		answers[MEDIA_HOST] = 404;
		const first = await provider('r2').probe(e as never);
		assert.equal(first.ok, false, 'still 404 from the stub');
		assert.ok(await e.MEDIA.head('pub/_health/probe.txt'), 'canary written');
		answers[MEDIA_HOST] = 200;
		const before = calls.length;
		assert.equal((await provider('r2').probe(e as never)).ok, true);
		assert.equal(calls.length - before, 1, 'one HEAD, no write');
	});

	it('an unreachable host is a failed probe, never a thrown error', async () => {
		answers[BUNNY_HOST] = 'throw';
		const r = await provider('bunny').probe(env() as never);
		assert.equal(r.ok, false);
		assert.match(r.error!, /timeout/);
	});
});

describe('provider settings routes', () => {
	function app(e = env()) {
		const a = new Hono();
		a.route('/internal/media', createMediaInternalRouter() as never);
		const call = async (method: string, path: string, body?: unknown) => {
			const res = await a.request(path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } }, e as never);
			return { status: res.status, body: (await res.json()) as { success: boolean; result?: any; problems?: { problem: string }[] } };
		};
		return { e, call };
	}

	it('GET migrates a stored legacy switch: same behaviour, version 2 view', async () => {
		const { e, call } = app();
		await e.global_settings.put(SETTINGS_KEY, JSON.stringify({ mode: 'split', r2Percent: 30, assign: 'view', transcode: true }));
		const { status, body } = await call('GET', '/internal/media/providers');
		assert.equal(status, 200);
		assert.equal(body.result.settings.version, 2);
		assert.equal(body.result.settings.playback.strategy, 'weighted');
		assert.deepEqual(body.result.settings.playback.weights, { r2: 30, bunny: 70 });
		assert.deepEqual(body.result.problems, []);
	});

	it('PUT saves and keeps the legacy fields for a rollback; the legacy GET still answers', async () => {
		const { e, call } = app();
		const settings = { ...DEFAULT_MEDIA_SETTINGS, playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['r2', 'bunny'] } };
		const put = await call('PUT', '/internal/media/providers', { settings, actorId: 'admin-1' });
		assert.equal(put.status, 200);
		const raw = await (await e.global_settings.get(SETTINGS_KEY))!.json<Record<string, unknown>>();
		assert.equal(raw.version, 2);
		assert.equal(raw.mode, 'r2');
		assert.equal(raw.updatedBy, 'admin-1');
		clearMediaSettingsCache();
		const legacy = await call('GET', '/internal/media/settings');
		assert.equal(legacy.body.result.mode, 'r2');
	});

	it('PUT refuses settings that leave new uploads unplayable (400 with the problems)', async () => {
		const { call } = app();
		const settings = { ...DEFAULT_MEDIA_SETTINGS, providers: { bunny: { enabled: false }, r2: { enabled: true } }, ingest: ['bunny'] };
		const res = await call('PUT', '/internal/media/providers', { settings, actorId: 'admin-1' });
		assert.equal(res.status, 400);
		assert.ok(res.body.problems!.some((p) => p.problem === 'ingest_disabled'));
		assert.equal((await readMediaSettings({ global_settings: undefined }, true)).version, 2, 'defaults unaffected');
	});

	it('PUT needs an actor', async () => {
		const { call } = app();
		assert.equal((await call('PUT', '/internal/media/providers', { settings: DEFAULT_MEDIA_SETTINGS })).status, 400);
	});

	it('the health check route runs one pass and returns the snapshot', async () => {
		const { e, call } = app();
		const res = await call('POST', '/internal/media/health/check');
		assert.equal(res.status, 200);
		assert.equal(res.body.result.providers.bunny.state, 'healthy');
		clearHealthCache();
		assert.equal((await readHealth(e as never))!.providers.r2!.state, 'healthy');
	});
});
