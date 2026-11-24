/**
 * Content flags (E20-B1, wiki E20 §5.4, §5.5): setting them, and what made for kids takes away, all
 * behind the `ageRules` switch. A switch that can't be read refuses new flags and keeps the kids rules on.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches, syncSearchDocument, writeFeatureSwitch } from '@al-ummah/shared-types';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentRepliesList } from '../src/endpoints/video/commentRepliesList';
import { UploadBatchInitiateEndpoint } from '../src/endpoints/video/uploadBatchInitiate';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { VideoFetch } from '../src/endpoints/video/videoFetch';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { RecommendationsGet } from '../src/endpoints/discovery/discovery';
import { WatchHistoryAdd } from '../src/endpoints/profile/watchHistoryAdd';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { WatchStatePut } from '../src/endpoints/watch-state/watchState';
import { personalOrder } from '../src/lib/ranking/personal';
import { poolSeeds } from '../src/lib/recommendations';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

type Json = Record<string, any>;
type Switch = 'on' | 'off' | 'unreadable';
const json = { 'Content-Type': 'application/json' };

class MemoryKV {
	store = new Map<string, string>();
	async get(key: string, type?: string) {
		const v = this.store.get(key);
		return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

const realFetch = globalThis.fetch;
beforeEach(() => {
	forgetFeatureSwitches();
	let guid = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (/\/collections/.test(url)) return Response.json(method === 'POST' ? { guid: 'coll-1' } : { items: [], totalItems: 0 });
		if (/\/library\/\d+\/videos$/.test(url) && method === 'POST') return Response.json({ guid: `00000000-0000-4000-8000-00000000000${++guid}`, videoLibraryId: 400189 });
		return new Response('not mocked', { status: 500 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	forgetFeatureSwitches();
});

const comment = { id: 'c1', userId: 'viewer', channelId: null, videoId: 'x', text: 'Salam', dateCreated: '2026-11-01T00:00:00.000Z', likes: [], replies: [] };

async function setup(state: Switch, videos: Json[] = []) {
	const db = new SqliteD1();
	const records: Json = {};
	for (const v of videos) {
		const record = videoFixture({ userId: 'owner', channelId: 'owner-ch', title: `Lecture ${v.id}`, category: 'lectures', comments: [], ...v });
		records[record.id as string] = record;
		await syncSearchDocument(db as never, 'video', record.id as string, record);
	}
	const env = {
		SEARCH_DB: db as unknown,
		videos: new MemoryBucket(records),
		channels: new MemoryBucket({ 'owner-ch': { id: 'owner-ch', userId: 'owner', name: 'Owner channel' } }),
		profiles: new MemoryBucket({ viewer: { id: 'viewer', displayName: 'Viewer', email: 'viewer@example.com' } }),
		watch_history: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		queue: new MemoryQueue(),
		MODERATION_QUEUE: new MemoryQueue(),
		TUS_SESSIONS: new MemoryKV(),
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '400189',
		bunny_hostname: 'vz-215a1ffd-a5a.b-cdn.net',
		image_storage_key: 'img',
		ZONE: 'zone',
	} as Json;
	if (state === 'on') await writeFeatureSwitch(env as never, { key: 'ageRules', enabled: true, expectedVersion: 0, actorId: 'usr_a', currentStored: false });
	if (state === 'unreadable') {
		env.SEARCH_DB = new Proxy(db, { get: (target, p) => (p === 'prepare' ? (sql: string) => { if (sql.includes('feature_switches')) throw new Error('D1 down'); return target.prepare(sql); } : (target as any)[p]?.bind?.(target) ?? (target as any)[p]) });
	}
	const call = async (userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
		const app = buildApp((r) => {
			r.post('/api/videos/upload/initiate', UploadInitiateEndpoint);
			r.post('/api/videos/upload/batch/initiate', UploadBatchInitiateEndpoint);
			r.get('/api/videos/:id', VideoFetch);
			r.put('/api/videos/:id', VideoUpdate);
			r.get('/api/videos/:id/comments', CommentList);
			r.get('/api/videos/:id/comments/:cid/replies', CommentRepliesList);
			r.post('/api/videos/:id/comments', CommentCreate);
			r.post('/api/watch-history', RecordWatchHistory);
			r.put('/api/watch-state/:videoId', WatchStatePut);
			r.post('/api/profiles/watch-history', WatchHistoryAdd);
			r.get('/api/recommendations', RecommendationsGet);
		}, userId ? { userId } : null);
		const res = await app.request(`https://videos.api.test${path}`, { method, headers: { ...json, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env as never);
		return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
	};
	return { env, db, call };
}

const stored = (env: Json, id: string) => env.videos.read(id) as Json;

describe('setting the flags', () => {
	it('the editor stores the owner’s choice while the switch is on', async () => {
		const t = await setup('on', [{ id: 'v1' }]);
		assert.equal((await t.call('owner', 'PUT', '/api/videos/v1', { ageRestricted: true })).status, 200);
		assert.equal(stored(t.env, 'v1').ageRestricted, true);
		assert.equal(stored(t.env, 'v1').ageRestrictedBy, 'creator');
		assert.equal((await t.call('owner', 'PUT', '/api/videos/v1', { ageRestricted: false, madeForKids: true })).status, 200);
		const v = stored(t.env, 'v1');
		assert.deepEqual([v.ageRestricted, v.ageRestrictedBy, v.madeForKids], [undefined, undefined, true]);
	});

	it('off: 404 feature_off; unreadable: 503; nothing is stored, and other edits go on', async () => {
		for (const [state, status, code] of [['off', 404, 'feature_off'], ['unreadable', 503, 'service_unavailable']] as const) {
			forgetFeatureSwitches();
			const t = await setup(state, [{ id: 'v1' }]);
			for (const body of [{ ageRestricted: true }, { madeForKids: false }, { title: 'New', madeForKids: true }]) {
				const r = await t.call('owner', 'PUT', '/api/videos/v1', body);
				assert.equal(r.status, status, JSON.stringify(r.body));
				assert.equal(r.body.code, code);
			}
			const v = stored(t.env, 'v1');
			assert.ok(!('ageRestricted' in v) && !('madeForKids' in v) && v.title === 'Lecture v1');
			assert.equal((await t.call('owner', 'PUT', '/api/videos/v1', { title: 'Renamed' })).status, 200);
			assert.equal(stored(t.env, 'v1').title, 'Renamed');
		}
	});

	it('never both, and a restriction staff set stays', async () => {
		const t = await setup('on', [{ id: 'v1', madeForKids: true }, { id: 'v2', ageRestricted: true, ageRestrictedBy: 'staff' }]);
		const both = await t.call('owner', 'PUT', '/api/videos/v1', { ageRestricted: true });
		assert.deepEqual([both.status, both.body.code], [400, 'content_flags_conflict']);
		const locked = await t.call('owner', 'PUT', '/api/videos/v2', { ageRestricted: false });
		assert.deepEqual([locked.status, locked.body.code], [403, 'age_restricted_locked']);
		assert.equal(stored(t.env, 'v2').ageRestrictedBy, 'staff');
	});

	it('staff lock the video while the owner’s edit is on its way: the edit is refused', async () => {
		const t = await setup('on', [{ id: 'v1', ageRestricted: true, ageRestrictedBy: 'creator' }]);
		const get = t.env.videos.get.bind(t.env.videos);
		let reads = 0;
		t.env.videos.get = async (key: string) => {
			const before = await get(key);
			if (key === 'v1' && ++reads === 1) await t.env.videos.put('v1', JSON.stringify({ ...stored(t.env, 'v1'), ageRestrictedBy: 'staff' }));
			return before;
		};
		const r = await t.call('owner', 'PUT', '/api/videos/v1', { ageRestricted: false, title: 'Lost' });
		assert.deepEqual([r.status, r.body.code], [403, 'age_restricted_locked']);
		const v = stored(t.env, 'v1');
		assert.deepEqual([v.ageRestricted, v.ageRestrictedBy, v.title], [true, 'staff', 'Lecture v1']);
	});

	it('someone else can’t set them', async () => {
		const t = await setup('on', [{ id: 'v1' }]);
		assert.ok((await t.call('stranger', 'PUT', '/api/videos/v1', { madeForKids: true })).status >= 400);
		assert.ok(!('madeForKids' in stored(t.env, 'v1')));
	});

	it('single and bulk uploads store them, or refuse before anything is created', async () => {
		const file = { title: 'Up', fileSize: 10, mimeType: 'video/mp4' };
		const single = (t: Awaited<ReturnType<typeof setup>>, flags: object) => t.call('owner', 'POST', '/api/videos/upload/initiate', { ...file, ...flags }, { channelId: 'owner-ch' });
		const bulk = (t: Awaited<ReturnType<typeof setup>>, flags: object) => t.call('owner', 'POST', '/api/videos/upload/batch/initiate', { videos: [{ ...file, title: 'Plain' }, { ...file, ...flags }] }, { channelId: 'owner-ch' });
		for (const [state, flags, status, code] of [
			['off', { madeForKids: true }, 404, 'feature_off'],
			['unreadable', { ageRestricted: true }, 503, 'service_unavailable'],
			['on', { ageRestricted: true, madeForKids: true }, 400, 'content_flags_conflict'],
		] as const) {
			forgetFeatureSwitches();
			const t = await setup(state);
			for (const send of [single, bulk]) {
				const r = await send(t, flags);
				assert.deepEqual([r.status, r.body.code], [status, code]);
			}
			assert.equal(t.env.videos.store.size, 0);
		}
		forgetFeatureSwitches();
		const t = await setup('on');
		assert.equal((await single(t, { madeForKids: true })).status, 200);
		assert.equal((await bulk(t, { ageRestricted: true })).status, 200);
		const records = [...t.env.videos.store.values()].map((v: string) => JSON.parse(v));
		assert.deepEqual(records.map((r: Json) => [r.madeForKids, r.ageRestricted, r.ageRestrictedBy]).sort(), [[true, undefined, undefined], [undefined, undefined, undefined], [undefined, true, 'creator']].sort());
	});
});

describe('made for kids', () => {
	const kids = { id: 'k1', madeForKids: true, comments: [comment] };

	it('comments are off everywhere, whatever the creator chose', async () => {
		for (const state of ['on', 'unreadable'] as const) {
			forgetFeatureSwitches();
			const t = await setup(state, [kids, { id: 'v1', comments: [comment] }]);
			const refused = await t.call('viewer', 'POST', '/api/videos/k1/comments', { content: 'Hello' });
			assert.equal(refused.status, 403, JSON.stringify(refused.body));
			assert.equal(refused.body.error, 'comments_disabled');
			assert.equal(stored(t.env, 'k1').comments.length, 1);
			const list = await t.call(null, 'GET', '/api/videos/k1/comments');
			assert.equal(list.status, 200);
			assert.ok(!JSON.stringify(list.body).includes('Salam'));
			assert.equal((await t.call(null, 'GET', '/api/videos/k1/comments/c1/replies')).status, 404);
			const watch = await t.call('viewer', 'GET', '/api/videos/k1');
			const view = watch.body.video ?? watch.body.result?.video ?? watch.body.result ?? watch.body;
			assert.equal(view.commentSettings, 'off');
			assert.equal(view.madeForKids, true);
			assert.equal((await t.call('viewer', 'POST', '/api/videos/v1/comments', { content: 'Hello' })).status < 300, true);
			assert.ok(JSON.stringify((await t.call(null, 'GET', '/api/videos/v1/comments')).body).includes('Salam'));
		}
	});

	it('switch off: nothing changes', async () => {
		const t = await setup('off', [kids]);
		assert.ok((await t.call('viewer', 'POST', '/api/videos/k1/comments', { content: 'Hello' })).status < 300);
		assert.ok(JSON.stringify((await t.call(null, 'GET', '/api/videos/k1/comments')).body).includes('Salam'));
		assert.equal((await t.call('viewer', 'POST', '/api/watch-history', { videoId: 'k1', progress: 10, duration: 100 })).status, 201);
	});

	it('watching one is not kept: history, profile history, position', async () => {
		for (const [state, kept] of [['on', false], ['unreadable', false], ['off', true]] as const) {
			forgetFeatureSwitches();
			const t = await setup(state, [kids, { id: 'v1' }]);
			const r = await t.call('viewer', 'POST', '/api/watch-history', { videoId: 'k1', progress: 10, duration: 100 });
			if (!kept) assert.deepEqual([r.status, r.body.recorded], [200, false]);
			assert.equal(t.env.watch_history.store.has('viewer:k1'), kept, state);
			if (!kept) {
				const put = await t.call('viewer', 'PUT', '/api/watch-state/k1', { position: 30, duration: 100, clientUpdatedAt: new Date().toISOString() });
				assert.equal(put.status, 200, JSON.stringify(put.body));
				assert.equal(put.body.applied, false);
				assert.equal(t.env.watch_history.store.size, 0);
			}
			const added = await t.call('viewer', 'POST', '/api/profiles/watch-history', { videoId: 'k1', watchTime: 10, totalDuration: 100, completed: false });
			assert.ok(added.status < 300, JSON.stringify(added.body));
			assert.equal(JSON.stringify(t.env.profiles.read('viewer')).includes('k1'), kept, state);
			assert.equal((await t.call('viewer', 'POST', '/api/watch-history', { videoId: 'v1', progress: 10, duration: 100 })).status, 201);
			assert.ok(t.env.watch_history.store.has('viewer:v1'));
		}
	});

	it('an imported video its creator called made for kids follows the same rules, until they say otherwise', async () => {
		const t = await setup('on', [{ id: 'k1', importedFrom: { madeForKids: true } }, { id: 'k2', importedFrom: { madeForKids: true }, madeForKids: false }]);
		assert.equal((await t.call('viewer', 'POST', '/api/videos/k1/comments', { content: 'Hello' })).status, 403);
		assert.ok((await t.call('viewer', 'POST', '/api/videos/k2/comments', { content: 'Hello' })).status < 300);
	});
});

describe('made for kids never shapes what a viewer is suggested', () => {
	const catalog = [
		{ id: 'seed', category: 'a', channelId: 'c-a' },
		{ id: 'k1', category: 'b', channelId: 'c-b', madeForKids: true },
		{ id: 'like-k1', category: 'b', channelId: 'c-b', dateCreated: '2020-01-01T00:00:00.000Z' },
		{ id: 'other', category: 'z', channelId: 'c-z' },
	];
	const watched = async (state: Switch, ...ids: string[]) => {
		const t = await setup(state, catalog);
		for (const id of ids) await t.env.watch_history.put(`viewer:${id}`, JSON.stringify({ videoId: id }));
		return t;
	};

	it('the seeds rule', () => {
		const v = (id: string, madeForKids?: boolean) => ({ id, ...(madeForKids ? { madeForKids } : {}) }) as never;
		const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);
		assert.deepEqual(ids(poolSeeds(v('s'), [v('k', true), v('a')], true)), ['s', 'a']);
		assert.deepEqual(ids(poolSeeds(v('s', true), [v('a')], true)), ['s']);
		assert.deepEqual(ids(poolSeeds(null, [v('k', true), v('a')], true)), ['a']);
		assert.deepEqual(ids(poolSeeds(v('s', true), [v('k', true), v('a')], false)), ['s', 'k', 'a']);
	});

	it('next to one, the list is the same for everyone', async () => {
		for (const [state, same] of [['on', true], ['unreadable', true], ['off', false]] as const) {
			forgetFeatureSwitches();
			const t = await watched(state, 'other', 'like-k1');
			const q = '/api/recommendations?videoId=k1&limit=2&excludeWatched=true';
			const mine = (await t.call('viewer', 'GET', q)).body;
			const anyone = (await t.call(null, 'GET', q)).body;
			assert.equal(mine.basedOn.includes('history'), !same, state);
			if (same) assert.deepEqual([mine.data.map((x: Json) => x.id), mine.basedOn], [anyone.data.map((x: Json) => x.id), anyone.basedOn]);
		}
	});

	it('one in the viewer’s history is not a seed', async () => {
		const score = async (state: Switch) => {
			forgetFeatureSwitches();
			const t = await watched(state, 'k1');
			const r = (await t.call('viewer', 'GET', '/api/recommendations?videoId=seed&limit=5')).body;
			return r.data.find((x: Json) => x.id === 'like-k1').recommendationScore as number;
		};
		const off = await score('off');
		assert.ok((await score('on')) < off);
		assert.ok((await score('unreadable')) < off);
	});

	it('nor does it shape the personal list', async () => {
		const score = async (state: Switch) => {
			forgetFeatureSwitches();
			const t = await watched(state, 'k1');
			return (await personalOrder(t.env as never, 'viewer', ['other', 'like-k1']))?.find((x) => x.id === 'like-k1')?.score ?? 0;
		};
		const off = await score('off');
		assert.ok((await score('on')) < off);
		assert.ok((await score('unreadable')) < off);
	});
});
