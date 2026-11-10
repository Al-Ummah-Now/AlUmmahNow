/**
 * Bounded reads on the request path (docs/architecture/SCALABILITY-AUDIT.md, AV-16).
 *
 * The subscription feed, the legacy video search and the scheduled-videos
 * list read their candidates from D1 (search_videos, content_ownership) and
 * then get only those objects; while the index is unavailable they scan at
 * most FALLBACK_SCAN_OBJECTS. None lists the whole videos bucket any more.
 *
 * Real endpoints against node:sqlite (search migrations, rows written by the
 * real sync code) and in-memory R2 buckets that count operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument } from '@al-ummah/shared-types';
import { SubscriptionFeed } from '../src/endpoints/channel/SubscriptionFeed';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { VideoScheduleList } from '../src/endpoints/video/scheduleList';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { FALLBACK_SCAN_OBJECTS } from '../src/lib/scanBudget';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T00:00:00.000Z');

/** Counts R2 operations by kind. */
class CountingBucket extends MemoryBucket {
	ops = { get: 0, list: 0, put: 0 };
	async get(key: string) { this.ops.get++; return super.get(key); }
	async list(opts: any = {}) { this.ops.list++; return super.list(opts); }
	async put(key: string, value: string, options?: any) { this.ops.put++; return super.put(key, value, options); }
}

function video(i: number, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: `v${String(i).padStart(4, '0')}`,
		title: i % 10 === 0 ? `Tafsir lesson ${i}` : `Video ${i}`,
		userId: `user${i % 20}`,
		channelId: `ch${i % 20}`,
		views: i,
		dateCreated: new Date(T0 - i * HOUR).toISOString(),
		uploadStatus: 'ready',
		...overrides,
	});
}

/** n videos in R2, indexed in search_videos and content_ownership (marked complete). */
async function catalogue(n: number, extra: Record<string, any>[] = []) {
	const db = new SqliteD1();
	const videos: Record<string, any> = {};
	for (let i = 0; i < n; i++) videos[video(i).id] = video(i);
	for (const v of extra) videos[v.id] = v;
	for (const v of Object.values(videos)) await syncSearchDocument(db as never, 'video', v.id, v, { version: 1 });
	const seed = { SEARCH_DB: db, videos: new MemoryBucket(videos), channels: new MemoryBucket({}) };
	await runOwnershipPass(seed as never, 'video');
	await runOwnershipPass(seed as never, 'channel');
	const bucket = new CountingBucket(videos);
	return { db, bucket, all: Object.values(videos) as any[], env: { SEARCH_DB: db, videos: bucket, channels: new MemoryBucket({}) } };
}

const newestFirst = (a: any, b: any) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated) || a.id.localeCompare(b.id);

function app(userId: string | null) {
	return buildApp((r: any) => {
		r.get('/api/feed', SubscriptionFeed);
		r.get('/api/videos/search', VideoSearch);
		r.get('/api/videos/scheduled', VideoScheduleList);
	}, userId ? { userId } : null);
}
async function get(path: string, env: unknown, userId: string | null = 'me') {
	const res = await app(userId).request(path, {}, env);
	assert.equal(res.status, 200, await res.clone().text());
	return (await res.json()) as any;
}

describe('subscription feed (AV-16)', () => {
	const profiles = () => new MemoryBucket({ me: { id: 'me', subscribedTo: ['ch3', 'ch7', 'ch11'] } });

	it('newest videos of the subscribed channels, paged, one get per video and no listing', async () => {
		const { bucket, all, env } = await catalogue(1200);
		const e = { ...env, profiles: profiles() };
		const expected = all.filter((v) => ['ch3', 'ch7', 'ch11'].includes(v.channelId)).sort(newestFirst).map((v) => v.id);
		const first = await get('/api/feed?limit=10', e);
		assert.deepEqual(first.data.map((v: any) => v.id), expected.slice(0, 10));
		assert.equal(first.total, expected.length);
		const second = await get(`/api/feed?limit=10&cursor=${first.cursor}`, e);
		assert.deepEqual(second.data.map((v: any) => v.id), expected.slice(10, 20));
		assert.deepEqual(bucket.ops, { get: 20, list: 0, put: 0 });
	});

	it('a video made private after it was indexed is left out (R2 decides)', async () => {
		const { bucket, all, env } = await catalogue(200);
		const newest = all.filter((v) => v.channelId === 'ch3').sort(newestFirst)[0];
		bucket.store.set(newest.id, JSON.stringify({ ...newest, isPublic: false }));
		const res = await get('/api/feed?limit=5', { ...env, profiles: profiles() });
		assert.ok(!res.data.some((v: any) => v.id === newest.id));
	});

	it('without the index: a bounded scan', async () => {
		const { bucket, env } = await catalogue(1200);
		await get('/api/feed?limit=10', { videos: bucket, channels: env.channels, profiles: profiles() });
		assert.ok(bucket.ops.list <= FALLBACK_SCAN_OBJECTS / 100, `${bucket.ops.list} lists`);
	});
});

describe('legacy video search (AV-16)', () => {
	it('a public query reads full-text candidates, never the bucket listing', async () => {
		const secret = video(5000, { title: 'Tafsir private notes', isPublic: false, userId: 'someone' });
		const { bucket, env } = await catalogue(1000, [secret]);
		const res = await get('/api/videos/search?q=tafsir&limit=50', env, null);
		assert.ok(res.data.length > 0);
		assert.ok(res.data.every((v: any) => /tafsir/i.test(v.title)));
		assert.ok(!res.data.some((v: any) => v.id === secret.id), 'private videos stay out');
		assert.equal(bucket.ops.list, 0);
		assert.ok(bucket.ops.get <= 200, `${bucket.ops.get} gets`);
	});

	it('a channel search loads at most the 500 newest of a large channel', async () => {
		const big = Array.from({ length: 700 }, (_, i) => video(10_000 + i, { channelId: 'big', userId: 'me', title: `Lecture ${i}` }));
		const { bucket, env } = await catalogue(50, big);
		const res = await get('/api/videos/search?channelIds=big&limit=20&sort=date', env);
		assert.equal(bucket.ops.list, 0);
		assert.ok(bucket.ops.get <= 500, `${bucket.ops.get} gets`);
		assert.deepEqual(res.data.map((v: any) => v.id), [...big].sort(newestFirst).slice(0, 20).map((v) => v.id));
	});

	it('an owner search reads the owner\'s videos from the index, private ones included', async () => {
		const mine = [video(9001, { userId: 'me', title: 'My private draft', isPublic: false }), video(9002, { userId: 'me', title: 'My public talk' })];
		const { bucket, env } = await catalogue(800, mine);
		const res = await get('/api/videos/search?isOwner=true&limit=50', env);
		assert.deepEqual(res.data.map((v: any) => v.id).sort(), mine.map((v) => v.id).sort());
		assert.equal(bucket.ops.list, 0);
		assert.equal(bucket.ops.get, 2);
	});
});

describe('scheduled videos (AV-16)', () => {
	it('the user\'s scheduled videos from the ownership index, no listing', async () => {
		const later = new Date(Date.now() + 24 * HOUR).toISOString();
		const scheduled = [
			video(8001, { userId: 'me', channelId: 'my-ch', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: later }),
			video(8002, { userId: 'me', channelId: 'my-ch', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: later }),
			video(8003, { userId: 'other', channelId: 'their-ch', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: later }),
		];
		const { bucket, env } = await catalogue(1000, scheduled);
		const res = await get('/api/videos/scheduled', env);
		const ids = JSON.stringify(res).match(/v8\d{3}/g) ?? [];
		assert.deepEqual([...new Set(ids)].sort(), ['v8001', 'v8002']);
		assert.equal(bucket.ops.list, 0);
		assert.equal(bucket.ops.get, 2);
	});

	it('signed out: nothing, and nothing read', async () => {
		const { bucket, env } = await catalogue(100);
		const res = await app(null).request('/api/videos/scheduled', {}, env);
		assert.ok(res.status === 200 || res.status === 401, String(res.status));
		assert.equal(bucket.ops.list, 0);
	});
});
