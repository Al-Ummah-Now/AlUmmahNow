import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument } from '@al-ummah/shared-types';
import { RecommendationsGet } from '../src/endpoints/discovery/discovery';
import { VideosList } from '../src/endpoints/video/videoList';
import { CANDIDATE_LIMITS, recommendationsCachePath } from '../src/lib/recommendations';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

class MemoryCache {
	entries = new Map<string, string>();
	ttls = new Map<string, string | null>();
	async match(url: string) {
		const body = this.entries.get(url);
		return body === undefined ? undefined : new Response(body);
	}
	async put(url: string, response: Response) {
		this.ttls.set(url, response.headers.get('Cache-Control'));
		this.entries.set(url, await response.text());
	}
}

let cache: MemoryCache;
beforeEach(() => {
	cache = new MemoryCache();
	(globalThis as any).caches = { default: cache };
});
afterEach(() => {
	delete (globalThis as any).caches;
});

const BASE = 'https://videos.api.test';
const video = (id: string, overrides: Record<string, unknown> = {}) =>
	videoFixture({ id, title: `Lecture ${id}`, category: 'lectures', channelId: 'ch1', ...overrides });

type Body = { data: Array<{ id: string }>; basedOn: string[] };
const ids = (body: Body) => body.data.map(v => v.id);

async function setup(records: Array<Record<string, any>>, extra: Record<string, unknown> = {}) {
	const db = new SqliteD1();
	const initial: Record<string, unknown> = {};
	for (const record of records) {
		initial[record.id] = record;
		await syncSearchDocument(db as never, 'video', record.id, record);
	}
	return {
		SEARCH_DB: db,
		videos: new MemoryBucket(initial),
		channels: new MemoryBucket(),
		profiles: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		...extra,
	} as Record<string, any>;
}

function get(env: Record<string, unknown>, query: string, userId?: string) {
	const app = buildApp(r => r.get('/api/recommendations', RecommendationsGet), userId ? { userId } : null);
	return app.request(`${BASE}/api/recommendations?${query}`, {}, env);
}

describe('GET /api/recommendations', () => {
	it('ranks same-category and same-channel videos first, without the current video', async () => {
		const env = await setup([
			video('seed', { tags: ['seerah'] }),
			video('near', { tags: ['seerah'] }),
			video('far', { category: 'nasheeds', channelId: 'other', title: 'Unrelated' }),
		]);
		const res = await get(env, 'videoId=seed&limit=15');
		assert.equal(res.status, 200);
		const body = (await res.json()) as Body;
		assert.equal(ids(body)[0], 'near');
		assert.ok(!ids(body).includes('seed'));
		assert.deepEqual(body.basedOn, ['video']);
	});

	it('carries each video\'s title per language and its publish date (an Arabic page shows the Arabic title)', async () => {
		const env = await setup([
			video('seed', { tags: ['seerah'] }),
			video('near', { tags: ['seerah'], title: 'Weak Hadith 2', titleLocalized: { en: 'Weak Hadith 2', ar: 'سلسلة الحديث الضعيف ٢' }, descriptionLocalized: { ar: 'وصف' }, publishedAt: '2026-11-01T00:00:00.000Z' }),
		]);
		const body = (await (await get(env, 'videoId=seed&limit=15')).json()) as { data: Array<Record<string, unknown>> };
		const near = body.data.find((v) => v.id === 'near')!;
		assert.deepEqual(near.titleLocalized, { en: 'Weak Hadith 2', ar: 'سلسلة الحديث الضعيف ٢' });
		assert.deepEqual(near.descriptionLocalized, { ar: 'وصف' });
		assert.equal(near.publishedAt, '2026-11-01T00:00:00.000Z');
	});

	it('respects the limit', async () => {
		const env = await setup(Array.from({ length: 30 }, (_, i) => video(`v${i}`)));
		const body = (await (await get(env, 'videoId=v0&limit=7')).json()) as Body;
		assert.equal(body.data.length, 7);
	});

	it('reads only the winners from R2 instead of scanning the bucket', async () => {
		const env = await setup(Array.from({ length: 120 }, (_, i) => video(`v${i}`)));
		env.videos.calls = 0;
		await get(env, 'videoId=v0&limit=10');
		// The winners (limit + buffer), plus the series continuation ("Lecture v1" follows "Lecture v0")
		assert.ok(env.videos.calls <= 16, `made ${env.videos.calls} R2 calls`);
	});

	it('bounds the candidates read per source', async () => {
		const env = await setup(Array.from({ length: CANDIDATE_LIMITS.category + 40 }, (_, i) => video(`v${i}`, { channelId: `c${i}` })));
		const batches: number[] = [];
		const realBatch = env.SEARCH_DB.batch.bind(env.SEARCH_DB);
		env.SEARCH_DB.batch = async (statements: unknown[]) => {
			const results = await realBatch(statements);
			batches.push(...results.map((r: { results: unknown[] }) => r.results.length));
			return results;
		};
		await get(env, 'videoId=v0&limit=5');
		assert.ok(batches.length > 0);
		assert.ok(batches.every(count => count <= CANDIDATE_LIMITS.category), `batch sizes ${batches}`);
	});

	it('drops a winner the index still lists but R2 says is hidden', async () => {
		const env = await setup([video('seed'), video('stale'), video('ok')]);
		await env.videos.put('stale', JSON.stringify(video('stale', { isHidden: true })));
		const body = (await (await get(env, 'videoId=seed')).json()) as Body;
		assert.deepEqual(ids(body), ['ok']);
	});

	it('falls back to scanning the bucket when the index is empty or fails', async () => {
		const records = [video('seed'), video('other')];
		const empty = await setup([]);
		for (const record of records) await empty.videos.put(record.id as string, JSON.stringify(record));
		assert.deepEqual(ids((await (await get(empty, 'videoId=seed')).json()) as Body), ['other']);

		const broken = await setup(records);
		broken.SEARCH_DB.batch = async () => { throw new Error('D1 down'); };
		assert.deepEqual(ids((await (await get(broken, 'videoId=seed')).json()) as Body), ['other']);
	});

	it('serves a repeat anonymous request from the cache', async () => {
		const env = await setup([video('seed'), video('other')]);
		const first = await get(env, 'videoId=seed');
		assert.equal(first.headers.get('X-Recommendations-Cache'), 'MISS');
		assert.match(first.headers.get('Cache-Control') ?? '', /public/);
		env.videos.calls = 0;
		const second = await get(env, 'videoId=seed');
		assert.equal(second.headers.get('X-Recommendations-Cache'), 'HIT');
		assert.equal(env.videos.calls, 0);
	});

	it('caches a full result for the normal time', async () => {
		const env = await setup([video('seed'), video('a'), video('b')]);
		const res = await get(env, 'videoId=seed&limit=2');
		assert.equal(res.headers.get('Cache-Control'), 'public, max-age=120');
	});

	it('never caches an empty result', async () => {
		const env = await setup([video('seed')]);
		const empty = await get(env, 'videoId=seed&limit=5');
		assert.deepEqual(ids((await empty.json()) as Body), []);
		assert.equal(empty.headers.get('Cache-Control'), 'no-store');
		assert.equal(cache.entries.size, 0);

		await env.videos.put('new', JSON.stringify(video('new')));
		await syncSearchDocument(env.SEARCH_DB as never, 'video', 'new', video('new'));
		assert.deepEqual(ids((await (await get(env, 'videoId=seed&limit=5')).json()) as Body), ['new']);
	});

	it('keeps a short result only briefly, on a hit too', async () => {
		const env = await setup([video('seed'), video('other')]);
		const first = await get(env, 'videoId=seed&limit=5');
		assert.equal(first.headers.get('Cache-Control'), 'public, max-age=10');
		const stored = [...cache.ttls.values()];
		assert.deepEqual(stored, ['public, max-age=10']);
		const second = await get(env, 'videoId=seed&limit=5');
		assert.equal(second.headers.get('X-Recommendations-Cache'), 'HIT');
		assert.equal(second.headers.get('Cache-Control'), 'public, max-age=10');
	});

	it('backfills excludeWatched with watched videos, after the unwatched ones', async () => {
		const env = await setup([video('seed'), video('fresh'), video('seen-1'), video('seen-2')]);
		await env.watch_history.put('u1:seen-1', JSON.stringify({ videoId: 'seen-1' }));
		await env.watch_history.put('u1:seen-2', JSON.stringify({ videoId: 'seen-2' }));
		const shown = ids((await (await get(env, 'videoId=seed&excludeWatched=true&limit=3', 'u1')).json()) as Body);
		assert.equal(shown[0], 'fresh');
		assert.deepEqual([...shown].sort(), ['fresh', 'seen-1', 'seen-2']);
		assert.ok(!shown.includes('seed'));
	});

	it('does not backfill excludeWatched when unwatched videos fill the limit', async () => {
		const env = await setup([video('seed'), video('fresh'), video('seen')]);
		await env.watch_history.put('u1:seen', JSON.stringify({ videoId: 'seen' }));
		const shown = ids((await (await get(env, 'videoId=seed&excludeWatched=true&limit=1', 'u1')).json()) as Body);
		assert.deepEqual(shown, ['fresh']);
	});

	it('keeps one viewer\'s personalised results away from others', async () => {
		const seeds = [
			video('seed', { category: 'a', channelId: 'c-a' }),
			video('alice-pick', { category: 'b', channelId: 'c-b', title: 'Fiqh', views: 100000 }),
			video('generic', { category: 'z', channelId: 'c-z', title: 'Misc' }),
			video('generic-2', { category: 'y', channelId: 'c-y', title: 'Other' }),
		];
		const env = await setup(seeds);
		await env.watch_history.put('alice:alice-pick', JSON.stringify({ videoId: 'alice-pick' }));

		const alice = await get(env, 'videoId=seed&excludeWatched=true&limit=2', 'alice');
		assert.equal(alice.headers.get('X-Recommendations-Cache'), 'MISS');
		assert.match(alice.headers.get('Cache-Control') ?? '', /private/);
		assert.equal(alice.headers.get('Vary'), 'Authorization');
		assert.ok(!ids((await alice.json()) as Body).includes('alice-pick'));

		for (const res of [await get(env, 'videoId=seed&excludeWatched=true&limit=2', 'bob'), await get(env, 'videoId=seed&limit=2')]) {
			assert.equal(res.headers.get('X-Recommendations-Cache'), 'MISS');
			assert.ok(ids((await res.json()) as Body).includes('alice-pick'));
		}
	});

	it('uses distinct cache keys per viewer, pause state and environment', async () => {
		const base = { videoId: 'v', limit: 15, excludeWatched: false };
		const anon = await recommendationsCachePath({ ...base, historyPaused: false });
		const alice = await recommendationsCachePath({ ...base, userId: 'alice', historyPaused: false });
		const bob = await recommendationsCachePath({ ...base, userId: 'bob', historyPaused: false });
		const paused = await recommendationsCachePath({ ...base, userId: 'alice', historyPaused: true });
		assert.equal(new Set([anon, alice, bob, paused]).size, 4);
		assert.ok(!alice.includes('alice'), 'the key does not expose the user id');

		const env = await setup([video('seed'), video('other')]);
		await get(env, 'videoId=seed&limit=1');
		const app = buildApp(r => r.get('/api/recommendations', RecommendationsGet), null);
		const otherEnv = await app.request('https://videos.api.other.test/api/recommendations?videoId=seed&limit=1', {}, env);
		assert.equal(otherEnv.headers.get('X-Recommendations-Cache'), 'MISS');
	});

	it('stops using history at once when it is paused', async () => {
		const env = await setup([video('seed'), video('watched', { title: 'Watched' })]);
		await env.watch_history.put('u1:watched', JSON.stringify({ videoId: 'watched' }));
		const active = (await (await get(env, 'videoId=seed', 'u1')).json()) as Body;
		assert.ok(active.basedOn.includes('history'));
		await env.profiles.put('u1', JSON.stringify({ id: 'u1', watchHistoryPaused: true }));
		const paused = (await (await get(env, 'videoId=seed', 'u1')).json()) as Body;
		assert.ok(!paused.basedOn.includes('history'));
	});

	it('seeds from the newest history without reading each entry', async () => {
		const env = await setup([video('seed'), video('w1')]);
		for (let i = 0; i < 40; i++) await env.watch_history.put(`u1:h${i}`, JSON.stringify({ videoId: `h${i}` }));
		env.watch_history.calls = 0;
		await get(env, 'videoId=seed', 'u1');
		assert.equal(env.watch_history.calls, 1);
	});
});

describe('GET /api/recommendations: numbered series continue in order (the owner, 2026-11-11)', () => {
	const lesson = (n: number, extra: Record<string, unknown> = {}) =>
		video(`l${n}`, { title: `Lesson ${n}`, dateCreated: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`, ...extra });

	it('Lesson 1 → Lesson 2 first, flagged, never Lesson 11', async () => {
		const env = await setup([lesson(1), lesson(11), lesson(2), lesson(3), video('other', { title: 'Lesson 1 notes' })]);
		const body = (await (await get(env, 'videoId=l1&limit=5')).json()) as Body & { data: Array<{ id: string; seriesNext?: boolean }> };
		assert.equal(body.data[0].id, 'l2');
		assert.equal(body.data[0].seriesNext, true);
		assert.equal(body.data.filter((v) => v.seriesNext).length, 1);
		assert.ok(!ids(body).includes('l1'));
	});

	it('a continuation outside the ranked shelf is still put first, within the limit', async () => {
		const many = Array.from({ length: 40 }, (_, i) => video(`x${i}`, { title: `Talk on ${'abcdefghij'[i % 10]}`, channelId: 'busy' }));
		const env = await setup([lesson(4, { channelId: 'series', category: 'other' }), lesson(5, { channelId: 'series', category: 'other' }), ...many]);
		const body = (await (await get(env, 'videoId=l4&limit=3')).json()) as Body & { data: Array<{ id: string; seriesNext?: boolean }> };
		assert.equal(body.data[0].id, 'l5');
		assert.equal(body.data.length, 3);
	});

	it('the series end: no flag, the normal ranking', async () => {
		const env = await setup([lesson(1), lesson(2), lesson(11)]);
		const body = (await (await get(env, 'videoId=l11&limit=5')).json()) as Body & { data: Array<{ id: string; seriesNext?: boolean }> };
		assert.ok(body.data.every((v) => !v.seriesNext));
	});

	it('reads the channel from the index, not the bucket', async () => {
		const env = await setup([lesson(1), lesson(2), ...Array.from({ length: 60 }, (_, i) => video(`v${i}`))]);
		env.videos.calls = 0;
		await get(env, 'videoId=l1&limit=5');
		assert.ok(env.videos.calls <= 12, `made ${env.videos.calls} R2 calls`);
	});
});

describe('GET /api/videos first-page cache', () => {
	const request = (env: Record<string, unknown>, query: string, userId?: string) =>
		buildApp(r => r.get('/api/videos', VideosList), userId ? { userId } : null).request(`${BASE}/api/videos?${query}`, {}, env);
	const envWith = () => ({ videos: new MemoryBucket({ a: video('a'), b: video('b') }), channels: new MemoryBucket() });

	it('reuses the anonymous first page', async () => {
		const env = envWith();
		const first = await (await request(env, 'limit=15')).json();
		env.videos.calls = 0;
		assert.deepEqual(await (await request(env, 'limit=15')).json(), first);
		assert.equal(env.videos.calls, 0);
	});

	it('does not cache signed-in views or later pages', async () => {
		const env = envWith();
		await request(env, 'limit=15', 'alice');
		await request(env, 'limit=1&cursor=a');
		assert.equal(cache.entries.size, 0);
	});
});
