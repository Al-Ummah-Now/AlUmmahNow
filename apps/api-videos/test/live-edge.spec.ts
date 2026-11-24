/** The self-hosted live edge serves a session's media only while its stream's state allows it (lib/live/access.ts). */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_STALE_MS, ACCESS_TTL_MS, MANAGER_URL_SECONDS, REVIEW_URL_SECONDS, forgetLiveAccess, liveSessionAccess, mayFetch, mustPurge, openReviewIds, sessionState, signManagerUrl as signLiveUrl } from '../src/lib/live/access';
import { handleLiveEdge } from '../src/lib/live/edge';
import { selfHostedKey } from '../src/lib/live/providers';
import { LiveStreamEnd, LiveStreamGet, LiveStreamIngestGet, LiveStreamStart, LiveStreamStateGet } from '../src/endpoints/live/liveSession';
import { assignTier, saveTier } from '../src/lib/creatorTiers';
import { LiveStreamCreate } from '../src/endpoints/live/liveStreamCreate';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { liveReviewSubject } from '../src/lib/review/live';
import { moderateLive } from '../src/lib/admin/liveModeration';
import { deleteStream, streamKey } from '../src/lib/live/streams';
import { signReviewVodUrl } from '../src/lib/live/vod-sign';
import { insertSession, updateSession } from '../src/lib/live/store';
import { withSearchSync } from '../src/lib/search/sync';
import { repairObject } from '../src/lib/search/repairs';
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
let refusePurge = false;
let cached: Map<string, Response>;

beforeEach(() => {
	forgetLiveAccess();
	purges = [];
	refusePurge = false;
	cached = new Map();
	now = Date.parse('2026-11-24T12:00:00Z');
	Date.now = () => now;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (String(url).includes('/purge_cache')) {
			purges.push(JSON.parse(String(init?.body)).prefixes);
			if (refusePurge) return new Response('{}', { status: 500 });
		}
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
		await assert.rejects(sessionState({ ...t.raw, videos: undefined } as never, A));
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
		const may = (value: string) => mayFetch(t.raw as never, A, { access: 'managers', reviewIds: [] }, value, now);
		now += 5_000;
		assert.equal(await sign(), url);
		assert.equal(await may(token), true);
		assert.equal(await may(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`), false);
		assert.equal(await may(token.replace(/\d{10}/, (n) => String(Number(n) + 1))), false);
		assert.equal(await may(await selfHostedKey(t.raw as never, A, 1)), false)
		assert.equal(await may(token.replace(/^m/, 'r')), false);
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

	it('every answer that carries one is the caller\'s alone: ingest, start, end and the list too', async () => {
		const t = await setup({ isPrivate: true });
		await updateSession(t.db as never, A, { status: 'live', ended_at: null });
		await t.write({ isPrivate: true, status: 'live' });
		await t.raw.channels.put('ch1', JSON.stringify({ id: 'ch1', userId: 'owner', name: 'Channel', members: [] }));
		await saveTier(t.db as never, 'creator', { live: true }, 'test');
		await assignTier(t.db as never, 'owner', 'creator', 'test');
		const app = buildApp((r) => {
			r.get('/api/live-streams', LiveStreamsList);
			r.post('/api/live-streams', LiveStreamCreate);
			r.get('/api/live-streams/:id/ingest', LiveStreamIngestGet);
			r.post('/api/live-streams/:id/start', LiveStreamStart);
			r.post('/api/live-streams/:id/end', LiveStreamEnd);
			r.patch('/api/live-streams/:id', LiveStreamUpdate);
			r.get('/api/live-streams/:id/state', LiveStreamStateGet);
			r.get('/api/live-streams/:id', LiveStreamGet);
		}, { userId: 'owner' });
		const ask = async (path: string, method = 'GET', body?: unknown) => {
			const res = await app.request(`/api/live-streams${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json', channelId: 'ch1' } } : {}) }, t.env as never);
			return { status: res.status, cache: res.headers.get('cache-control'), result: ((await res.json()) as Json).result };
		};
		const plays = async (url: string) => { assert.match(url, /\/hls\/[^/]+\/m\.\d{10}\.[0-9a-f]{40}\//); assert.equal((await t.get(url)).status, 200); };
		const one = await ask('/s1');
		assert.equal(one.cache, 'private, no-store');
		await plays(one.result.stream.playbackUrl);
		await plays(one.result.stream.vodUrl);
		const list = await ask('');
		assert.equal(list.status, 200, JSON.stringify(list.result));
		assert.equal(list.cache, 'private, no-store');
		await plays(list.result.data[0].playbackUrl);
		await plays(list.result.data[0].vodUrl);
		const state = await ask('/s1/state');
		assert.equal(state.cache, 'private, no-store');
		await plays(state.result.vodUrl);
		const started = await ask('/s1/start', 'POST');
		assert.equal(started.status, 200, JSON.stringify(started.result));
		assert.equal(started.cache, 'private, no-store');
		await plays(started.result.state.playbackUrl);
		const updated = await ask('/s1', 'PATCH', { title: 'Renamed' });
		assert.equal(updated.status, 200, JSON.stringify(updated.result));
		assert.equal(updated.cache, 'private, no-store');
		await plays(updated.result.stream.vodUrl);
		const end = await ask('/s1/end', 'POST');
		assert.equal(end.status, 200, JSON.stringify(end.result));
		assert.equal(end.cache, 'private, no-store');
		await plays(end.result.state.vodUrl);
		const ingest = await ask('/s1/ingest');
		assert.equal(ingest.status, 200, JSON.stringify(ingest.result));
		assert.equal(ingest.cache, 'private, no-store');
		await plays(ingest.result.state.vodUrl);
		const created = await ask('', 'POST', { title: 'New', isPrivate: true });
		assert.equal(created.status, 200, JSON.stringify(created));
		assert.equal(created.cache, 'private, no-store');
		assert.match(created.result.stream.playbackUrl, /\/hls\/[^/]+\/m\.\d{10}\.[0-9a-f]{40}\//);
		// Nothing is signed for a stream that is open to everyone
		const open = await setup();
		const list2 = await app.request('/api/live-streams', {}, open.env as never);
		assert.equal(((await list2.json()) as Json).result.data[0].vodUrl, `https://${HOST}/hls/${A}/vod.m3u8`);
	});
});

describe('the review of a recording', () => {
	const review = (status: string, reviewId = 'r1') => ({ review: { status, reviewId, timing: 'post', since: '2026-11-24T00:00:00Z' } });
	const urlOf = async (t: Awaited<ReturnType<typeof setup>>, reviewId = 'r1') => (await signReviewVodUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`, reviewId))!;

	it('reads it whatever the stream\'s state, while the review is open', async () => {
		for (const state of [{}, { isHidden: true }, { isHidden: true, suspensionHolds: ['user:owner'] }, { isDeleted: true, isHidden: true }, { isPrivate: true }]) {
			for (const status of ['checking', 'in_review', 'appealed', 'post_review', 'rejected']) {
				const t = await setup({ ...review(status), ...state });
				const url = await urlOf(t);
				for (const path of ['vod.m3u8', '720/index.m3u8', '720/seg_1.m4s']) {
					const res = await t.get(url.replace('vod.m3u8', path));
					assert.equal(res.status, 200, JSON.stringify([state, status, path]));
					if (Object.keys(state).length) assert.equal(res.cache, 'private, no-store');
				}
				forgetLiveAccess();
			}
		}
		const shadow = await setup({ isHidden: true, reviewShadow: { reviewId: 'r1', queuedAt: 'x' } });
		assert.equal((await shadow.get(await urlOf(shadow))).status, 200);
	});

	it('nobody else does, and not after it: a manager\'s token, another review, another session, approved, a takedown, no record', async () => {
		const t = await setup({ ...review('in_review'), isHidden: true });
		const url = await urlOf(t);
		assert.equal((await t.get(url)).status, 200);
		assert.equal((await t.get((await signLiveUrl(t.raw as never, `https://${HOST}/hls/${A}/vod.m3u8`))!)).status, 404);
		assert.equal((await t.get(await urlOf(t, 'r2'))).status, 404);
		assert.equal((await t.get(url.replace(A, B))).status, 404);
		assert.equal((await t.get(url.replace('/r.', '/m.'))).status, 404);
		for (const over of [{ ...review('approved'), isHidden: true }, { ...review('in_review', 'r2'), isHidden: true }, { isHidden: true }, { ...review('in_review'), isHidden: true, csamTakedown: { caseId: 'c' } }]) {
			await t.write(over);
			assert.equal((await t.get(url)).status, 404, JSON.stringify(over));
		}
		await t.write({ ...review('in_review'), isHidden: true });
		assert.equal((await t.get(url)).status, 200);
		now += 2 * REVIEW_URL_SECONDS * 1000;
		assert.equal((await t.get(url)).status, 404, 'expired');
		await t.env.videos.delete(streamKey('s1'));
		await t.settle();
		now += ACCESS_TTL_MS;
		assert.equal((await t.get(await urlOf(t))).status, 404, 'the stream is gone');
		assert.deepEqual(openReviewIds(null), []);
	});

	it('the moderators\' page gets a URL that plays for a hidden recording', async () => {
		const t = await setup({ ...review('in_review'), isHidden: true });
		const subject = await liveReviewSubject(t.env as never, 's1');
		assert.equal((await t.get(subject!.playUrl!)).status, 200);
		// An approved review beside an open shadow check: the open one
		await t.write({ ...review('approved', 'old'), reviewShadow: { reviewId: 'r2', queuedAt: 'x' }, isHidden: true });
		assert.equal((await t.get((await liveReviewSubject(t.env as never, 's1'))!.playUrl!)).status, 200);
	});
});

describe('the CDN purge', () => {
	it('a write overtaken by one that closed the stream still purges; nothing else does', () => {
		assert.equal(mustPurge('public', 'none', 'none'), true);
		assert.equal(mustPurge('none', 'public', 'none'), true, 'an older public write, dropped as stale');
		assert.equal(mustPurge('managers', 'none', 'none'), true);
		for (const same of ['public', 'managers', 'none'] as const) assert.equal(mustPurge(same, same, same), false);
		assert.equal(mustPurge('none', 'public', 'public'), false);
		assert.equal(mustPurge(null, 'managers', 'managers'), false, 'a new private stream');
		assert.equal(mustPurge('public', 'none', null), true, 'deleted');
	});

	it('refused, or the index write failed: the repair job purges it', async () => {
		const t = await setup();
		refusePurge = true;
		await t.write({ isHidden: true });
		const row = () => t.db.prepare("SELECT entity, id FROM index_repairs WHERE entity = 'stream'").bind().first() as Promise<any>;
		assert.equal((await row())?.id, 's1');
		const repair = () => repairObject(t.raw as never, { entity: 'stream', id: 's1', key: streamKey('s1') });
		await assert.rejects(repair(), /purge failed/);
		refusePurge = false;
		purges = [];
		await repair();
		assert.deepEqual(purges.at(-1)!.sort(), [`${HOST}/hls/${A}/`, `${HOST}/hls/${B}/`]);
		purges = [];
		await t.write({});
		await repair();
		assert.equal(purges.length, 0, 'an open stream');
	});

	it('runs when fewer people may watch, once, in a bounded number of calls', async () => {
		const t = await setup();
		assert.equal(purges.length, 0);
		await t.write({ title: 'Renamed' });
		assert.equal(purges.length, 0, 'an open stream edited');
		await t.write({ isPrivate: true });
		assert.equal(purges.length, 1);
		for (const title of ['a', 'b', 'c']) await t.write({ isPrivate: true, title });
		assert.equal(purges.length, 1, 'a private stream edited');
		await t.write({ isPrivate: true, isHidden: true });
		assert.equal(purges.length, 2, 'now nobody');
		await t.write({ isPrivate: true });
		await t.write({});
		assert.equal(purges.length, 2, 'opened again');
		await t.write({ review: { status: 'rejected', reviewId: 'r1' } });
		assert.equal(purges.length, 3, 'held by review');
		await t.env.videos.delete(streamKey('s1'));
		await t.settle();
		assert.equal(purges.length, 4, 'deleted');
		await t.env.videos.delete(streamKey('s1'));
		await t.settle();
		assert.equal(purges.length, 4, 'already gone');
		// A stream with a great many sessions
		const many = await setup();
		purges = [];
		for (let i = 0; i < 200; i++) await many.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES (?, 's1', 'selfhosted', 'ended', 'round_robin', ?, 1)").bind(`sess-${i}`, i).run();
		await many.write({ isHidden: true });
		assert.equal(purges.length, 3);
		assert.ok(purges.every((p) => p.length <= 30));
	});
});
