/** The self-hosted live edge serves a session's media only while its stream's state allows it (lib/live/access.ts). */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_STALE_MS, ACCESS_TTL_MS, MANAGER_URL_SECONDS, forgetLiveAccess, liveSessionAccess, sessionAccess, signLiveUrl, verifyViewToken } from '../src/lib/live/access';
import { handleLiveEdge } from '../src/lib/live/edge';
import { selfHostedKey } from '../src/lib/live/providers';
import { LiveStreamGet, LiveStreamStateGet } from '../src/endpoints/live/liveSession';
import { moderateLive } from '../src/lib/admin/liveModeration';
import { deleteStream, streamKey } from '../src/lib/live/streams';
import { signReviewVodUrl } from '../src/lib/live/vod-sign';
import { insertSession, updateSession } from '../src/lib/live/store';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;
const HOST = 'live.test';
const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = 0;
let purges: string[][];
let cached: Map<string, Response>;

beforeEach(() => {
	forgetLiveAccess();
	purges = [];
	cached = new Map();
	now = Date.parse('2026-11-24T12:00:00Z');
	Date.now = () => now;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (String(url).includes('/purge_cache')) purges.push(JSON.parse(String(init?.body)).prefixes);
		return Response.json({ success: true });
	}) as never;
	(globalThis as any).caches = {
		default: {
			match: async (req: Request) => cached.get(req.url)?.clone(),
			put: async (req: Request, res: Response) => void cached.set(req.url, res),
			delete: async () => true,
		},
	};
});
afterEach(() => {
	globalThis.fetch = realFetch;
	Date.now = realNow;
	delete (globalThis as any).caches;
});

async function setup(stream: Json = {}) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const files = new Map<string, string>();
	const LIVE_MEDIA = {
		get: async (key: string) => (files.has(key) ? { body: files.get(key), size: files.get(key)!.length, httpEtag: '"e"', writeHttpMetadata: (h: Headers) => h.set('cache-control', 'public, max-age=31536000, immutable') } : null),
		list: async () => ({ objects: [], truncated: false }),
	};
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), LIVE_MEDIA, LIVE_PUBLIC_HOST: HOST, LIVE_INGEST_SECRET: 'synthetic-secret', MEDIA_CDN_API_TOKEN: 'synthetic-token', ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue() };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts']) raw[b] = new MemoryBucket();
	const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
	const env = withSearchSync(raw, ctx) as Json;
	const settle = async () => { while (pending.length) await pending.shift(); };
	for (const id of [A, B]) {
		await insertSession(db as never, { id, stream_id: 's1', channel_id: 'ch1', provider: 'selfhosted', provider_ref: id, reason: 'round_robin', preferred: null, seq: 1, failover_from: null, failover_error: null, low_latency: 0, is_test: 0, created_at: now, playback_url: `https://${HOST}/hls/${id}/master.m3u8`, owner_id: 'owner', limit_minutes: null });
		await updateSession(db as never, id, { status: 'ended', first_segment_at: now, vod_url: `https://${HOST}/hls/${id}/vod.m3u8`, vod_ready_at: now });
		for (const f of ['vod.m3u8', 'master.m3u8', '720/index.m3u8', '720/init.mp4', '720/seg_1.m4s']) files.set(`live/${id}/${f}`, `${id} ${f}`);
	}
	const write = async (over: Json) => {
		await env.videos.put(streamKey('s1'), JSON.stringify({ id: 's1', userId: 'owner', channelId: 'ch1', title: 'Halqa', status: 'ended', sessionId: A, playbackUrl: `https://${HOST}/hls/${A}/master.m3u8`, vodUrl: `https://${HOST}/hls/${A}/vod.m3u8`, dateCreated: '2026-11-20T10:00:00.000Z', ...over }));
		await settle();
		now += ACCESS_TTL_MS;
	};
	await write(stream);
	const get = async (path: string, method = 'GET') => {
		const res = await handleLiveEdge(new Request(path.startsWith('http') ? path : `https://${HOST}${path}`, { method }), raw as never, ctx as never, { onLive: async () => undefined });
		return { status: res.status, body: method === 'HEAD' ? '' : await res.text(), cache: res.headers.get('cache-control') };
	};
	const status = async (path = `/hls/${A}/720/seg_1.m4s`) => (await get(path)).status;
	return { db, raw, env, files, settle, write, get, status };
}

describe('who may fetch a session', () => {
	it('the stream\'s state decides, whatever put it there', () => {
		const rec = { sessionId: A };
		assert.equal(liveSessionAccess(rec, A), 'public');
		assert.equal(liveSessionAccess(null, A), 'none');
		assert.equal(liveSessionAccess({ ...rec, isHidden: true }, A), 'none');
		assert.equal(liveSessionAccess({ ...rec, isDeleted: true, isPrivate: true }, A), 'none');
		assert.equal(liveSessionAccess({ ...rec, isPrivate: true }, A), 'managers');
		assert.equal(liveSessionAccess({ ...rec, review: { status: 'rejected' } }, A), 'managers');
		// Live again after a held recording: the new session only, never the held one
		const again = { sessionId: B, liveAgainSessionId: B, review: { status: 'rejected' } };
		assert.equal(liveSessionAccess(again, B), 'public');
		assert.equal(liveSessionAccess(again, A), 'managers');
	});

	it('an open stream is served, kept at the edge and counted as before', async () => {
		const t = await setup();
		const first = await t.get(`/hls/${A}/720/seg_1.m4s`);
		assert.deepEqual([first.status, first.body, first.cache], [200, `${A} 720/seg_1.m4s`, 'public, max-age=31536000, immutable']);
		await t.settle();
		t.files.clear();
		assert.equal(await t.status(), 200, 'from the edge cache');
		assert.equal((await t.get(`/hls/${A}/720/seg_1.m4s`, 'HEAD')).status, 200);
		assert.equal(await t.status(`/hls/${B}/vod.m3u8`), 404, 'a file that is not there');
		assert.equal(await t.status('/hls/99999999-2222-4333-8444-555555555555/vod.m3u8'), 404, 'a session nobody made');
	});

	for (const [name, over] of [
		['hidden by a moderator', { isHidden: true }],
		['held by a suspension', { isHidden: true, suspensionHolds: ['channel:ch1'] }],
		['deleted by a moderator', { isDeleted: true, isHidden: true }],
		['private', { isPrivate: true }],
		['held by the review of its recording', { review: { status: 'rejected', reviewId: 'r1' } }],
	] as Array<[string, Json]>) {
		it(`${name}: nothing is served, cached copies neither, and the CDN drops both sessions`, async () => {
			const t = await setup();
			for (const f of ['vod.m3u8', 'master.m3u8', '720/index.m3u8', '720/init.mp4', '720/seg_1.m4s']) assert.equal(await t.status(`/hls/${A}/${f}`), 200);
			await t.settle();
			assert.ok(cached.size >= 5);
			await t.write(over);
			for (const f of ['vod.m3u8', 'master.m3u8', '720/index.m3u8', '720/init.mp4', '720/seg_1.m4s']) {
				const res = await t.get(`/hls/${A}/${f}`);
				assert.deepEqual([res.status, res.cache], [404, 'no-store'], f);
			}
			assert.equal((await t.get(`/hls/${A}/vod.m3u8`, 'HEAD')).status, 404);
			assert.deepEqual(purges.at(-1)!.sort(), [`${HOST}/hls/${A}/`, `${HOST}/hls/${B}/`]);
			// Open again
			await t.write({});
			assert.equal(await t.status(), 200);
		});
	}

	it('the paths that hide a stream all reach the edge: the moderator\'s decision, and the owner\'s deletion', async () => {
		for (const action of ['removed', 'deleted', 'banned'] as const) {
			const t = await setup();
			assert.equal(await t.status(), 200);
			await moderateLive(t.env as never, { entityType: 'livestream', entityId: 's1', action, actorId: 'usr_mod' }, now);
			await t.settle();
			now += ACCESS_TTL_MS;
			assert.equal(await t.status(), 404, action);
			assert.ok(purges.length, action);
			forgetLiveAccess();
		}
		const t = await setup();
		assert.equal(await t.status(), 200);
		await deleteStream(t.env as never, JSON.parse(await (await t.raw.videos.get(streamKey('s1'))).text()), now);
		await t.settle();
		now += ACCESS_TTL_MS;
		assert.equal(await t.status(), 404);
		assert.deepEqual(purges.at(-1)!.sort(), [`${HOST}/hls/${A}/`, `${HOST}/hls/${B}/`]);
	});

	it('a change is in force within the lookup\'s few seconds, and one lookup serves them', async () => {
		const t = await setup();
		let reads = 0;
		const videos = t.raw.videos;
		t.raw.videos = new Proxy(videos, { get: (o, p) => (p === 'get' ? (k: string) => (reads++, o.get(k)) : typeof o[p] === 'function' ? o[p].bind(o) : o[p]) });
		await Promise.all(Array.from({ length: 20 }, () => t.status()));
		assert.equal(reads, 1);
		videos.store.set(streamKey('s1'), JSON.stringify({ id: 's1', isHidden: true }));
		assert.equal(await t.status(), 200);
		now += ACCESS_TTL_MS;
		assert.equal(await t.status(), 404);
	});

	it('when the state cannot be read: what was just known holds briefly, then the edge refuses', async () => {
		const t = await setup();
		assert.equal(await t.status(), 200);
		t.raw.videos = { get: async () => { throw new Error('down'); } };
		now += ACCESS_TTL_MS;
		assert.equal(await t.status(), 200);
		now += ACCESS_STALE_MS;
		const res = await t.get(`/hls/${A}/720/seg_1.m4s`);
		assert.deepEqual([res.status, res.cache], [503, 'no-store']);
		forgetLiveAccess();
		await assert.rejects(sessionAccess({ ...t.raw, videos: undefined } as never, A));
	});
});

describe('signed URLs', () => {
	it('open a private or held stream, keep their token through the playlists, and are never kept', async () => {
		for (const over of [{ isPrivate: true }, { review: { status: 'rejected', reviewId: 'r1' } }]) {
			const t = await setup(over);
			const url = (await signLiveUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`))!;
			for (const path of ['vod.m3u8', '720/index.m3u8', '720/seg_1.m4s']) {
				const res = await t.get(url.replace('vod.m3u8', path));
				assert.deepEqual([res.status, res.body, res.cache], [200, `${A} ${path}`, 'private, no-store']);
			}
			await t.settle();
			assert.equal(await t.status(), 404, 'without the token');
			assert.equal(await t.status(url.replace(`https://${HOST}`, '').replace(A, B)), 404, 'another session\'s token');
		}
	});

	it('never open what is hidden, deleted or gone', async () => {
		const t = await setup({ isPrivate: true });
		const url = (await signLiveUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`))!;
		assert.equal((await t.get(url)).status, 200);
		for (const over of [{ isHidden: true }, { isPrivate: true, isDeleted: true }]) {
			await t.write(over);
			assert.equal((await t.get(url)).status, 404);
		}
		await t.env.videos.delete(streamKey('s1'));
		await t.settle();
		now += ACCESS_TTL_MS;
		assert.equal((await t.get(url)).status, 404);
	});

	it('expire, refuse tampering, stay the same while polled, and are not stream keys', async () => {
		const t = await setup({ isPrivate: true });
		const sign = async () => (await signLiveUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`))!;
		const url = await sign();
		const token = url.split('/')[5]!;
		now += 5_000;
		assert.equal(await sign(), url);
		assert.equal(await verifyViewToken(t.raw as never, A, token, now), true);
		assert.equal(await verifyViewToken(t.raw as never, A, `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, now), false);
		assert.equal(await verifyViewToken(t.raw as never, A, `${Number(token.slice(0, 10)) + 1}${token.slice(10)}`, now), false);
		assert.equal(await verifyViewToken(t.raw as never, A, await selfHostedKey(t.raw as never, A, 1), now), false);
		now += 2 * MANAGER_URL_SECONDS * 1000;
		assert.equal((await t.get(url)).status, 404);
		// Other URLs are left alone, and nothing is signed without the secret
		assert.equal(await signLiveUrl(t.raw as never, 'https://vz-x.b-cdn.net/a/playlist.m3u8'), 'https://vz-x.b-cdn.net/a/playlist.m3u8');
		assert.equal(await signLiveUrl({ LIVE_PUBLIC_HOST: HOST } as never, `https://${HOST}/hls/${A}/vod.m3u8`), `https://${HOST}/hls/${A}/vod.m3u8`);
	});

	it('the API gives them to the stream\'s managers only, and only when the plain URL is closed', async () => {
		const read = async (t: Awaited<ReturnType<typeof setup>>, userId: string | undefined, path = '') => {
			const app = buildApp((r) => {
				r.get('/api/live-streams/:id/state', LiveStreamStateGet);
				r.get('/api/live-streams/:id', LiveStreamGet);
			}, userId ? { userId } : {});
			const res = await app.request(`/api/live-streams/s1${path}`, {}, t.env as never);
			return { status: res.status, body: (await res.json()) as Json };
		};
		const open = await setup();
		assert.equal((await read(open, 'owner')).body.result.stream.vodUrl, `https://${HOST}/hls/${A}/vod.m3u8`);
		const closed = await setup({ isPrivate: true });
		assert.equal((await read(closed, undefined)).status, 404);
		assert.equal((await read(closed, 'someone')).status, 404);
		for (const path of ['', '/state']) {
			const { body } = await read(closed, 'owner', path);
			const vodUrl = path ? body.result.vodUrl : body.result.stream.vodUrl;
			assert.notEqual(vodUrl, `https://${HOST}/hls/${A}/vod.m3u8`);
			assert.equal((await closed.get(vodUrl)).status, 200);
		}
		const hidden = await setup({ isHidden: true });
		assert.equal((await read(hidden, 'owner')).body.result.stream.vodUrl, `https://${HOST}/hls/${A}/vod.m3u8`);
	});

	it('a recording held for review still reaches its review', async () => {
		const t = await setup({ review: { status: 'rejected', reviewId: 'r1' } });
		const url = (await signReviewVodUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`))!;
		assert.equal((await t.get(url)).status, 200);
	});
});
