/**
 * Home sections from the D1 search index (docs/architecture/SCALABILITY-AUDIT.md, AV-15).
 *
 * A section page is one indexed D1 query plus one R2 get per video on the
 * page: no bucket listing, no rebuild on the request path, however many
 * visitors arrive at once and however large the catalogue. Without SEARCH_DB
 * the stored R2 index is served even when stale, else one bounded page.
 *
 * Real endpoints against node:sqlite (search migrations, rows written by the
 * real index sync) and an in-memory R2 bucket that counts operations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncSearchDocument, VideoCategory } from '@al-ummah/shared-types';
import { PopularVideosSection } from '../src/endpoints/sections/popular';
import { RecentVideosSection } from '../src/endpoints/sections/recent';
import { TrendingVideosSection } from '../src/endpoints/sections/trending';
import { CategoryVideosSection } from '../src/endpoints/sections/by-category';
import { processTrendingVideos } from '../src/lib/trendingAlgorithm';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const CATEGORIES = Object.values(VideoCategory) as string[];
const HOUR = 60 * 60 * 1000;

/** Counts R2 operations by kind. */
class CountingBucket extends MemoryBucket {
	ops = { get: 0, list: 0, put: 0 };
	async get(key: string) { this.ops.get++; return super.get(key); }
	async list(opts: any = {}) { this.ops.list++; return super.list(opts); }
	async put(key: string, value: string, options?: any) { this.ops.put++; return super.put(key, value, options); }
}

function video(i: number, overrides: Record<string, unknown> = {}) {
	return videoFixture({
		id: `v${String(i).padStart(3, '0')}`,
		title: `Video ${i}`,
		channelId: `ch${i % 5}`,
		category: CATEGORIES[i % 3],
		views: (i * 37) % 1000,
		// Stored like the API stores them: arrays, with the counts the responses show
		likes: Array.from({ length: i % 17 }, (_, k) => `u${k}`),
		likesCount: i % 17,
		comments: Array.from({ length: i % 7 }, (_, k) => ({ id: `c${k}` })),
		commentsCount: i % 7,
		dateCreated: new Date(Date.now() - i * 3 * HOUR).toISOString(),
		uploadStatus: 'ready',
		...overrides,
	});
}

async function catalogue(n: number) {
	const db = new SqliteD1();
	const videos: Record<string, any> = {};
	for (let i = 0; i < n; i++) {
		const v = video(i);
		videos[v.id] = v;
		await syncSearchDocument(db as never, 'video', v.id, v, { version: 1 });
	}
	const bucket = new CountingBucket(videos);
	return { db, bucket, videos: Object.values(videos) as any[], env: { SEARCH_DB: db, videos: bucket } };
}

const app = buildApp((r: any) => {
	r.get('/api/sections/popular', PopularVideosSection);
	r.get('/api/sections/recent', RecentVideosSection);
	r.get('/api/sections/trending', TrendingVideosSection);
	r.get('/api/sections/by-category/:category', CategoryVideosSection);
});
const get = async (path: string, env: unknown) => {
	const res = await app.request(path, {}, env);
	assert.equal(res.status, 200, await res.clone().text());
	return (await res.json()) as any;
};

describe('home sections from the search index (AV-15)', () => {
	it('popular: ordered by views, paged by cursor, one get per video and no listing', async () => {
		const { bucket, videos, env } = await catalogue(300);
		const expected = [...videos].sort((a, b) => b.views - a.views || Date.parse(b.dateCreated) - Date.parse(a.dateCreated) || a.id.localeCompare(b.id)).map((v) => v.id);
		const first = await get('/api/sections/popular?limit=12', env);
		assert.deepEqual(first.data.map((v: any) => v.id), expected.slice(0, 12));
		assert.equal(first.metadata.fromIndex, true);
		assert.equal(first.metadata.totalCount, 300);
		const second = await get(`/api/sections/popular?limit=12&cursor=${encodeURIComponent(first.cursor)}`, env);
		assert.deepEqual(second.data.map((v: any) => v.id), expected.slice(12, 24));
		assert.deepEqual(bucket.ops, { get: 24, list: 0, put: 0 });
	});

	it('popular per period and minimum views', async () => {
		const { videos, env } = await catalogue(120);
		const weekly = await get('/api/sections/popular?limit=50&period=weekly&minViews=100', env);
		const expected = videos.filter((v) => Date.now() - Date.parse(v.dateCreated) <= 7 * 24 * HOUR && v.views >= 100).length;
		assert.equal(weekly.metadata.totalCount, expected);
		assert.ok(weekly.data.every((v: any) => v.views >= 100 && Date.now() - Date.parse(v.dateCreated) <= 7 * 24 * HOUR));
	});

	it('recent: newest first, by channel and without excluded channels', async () => {
		const { videos, env } = await catalogue(60);
		const newest = await get('/api/sections/recent?limit=10', env);
		assert.deepEqual(newest.data.map((v: any) => v.id), videos.slice(0, 10).map((v) => v.id));
		const channel = await get('/api/sections/recent?limit=50&channelId=ch2', env);
		assert.ok(channel.data.length > 0 && channel.data.every((v: any) => v.channelId === 'ch2'));
		assert.equal(channel.metadata.totalCount, videos.filter((v) => v.channelId === 'ch2').length);
	});

	it('trending ranks with the same score as before (every video a candidate)', async () => {
		const { videos, env } = await catalogue(150);
		const res = await get('/api/sections/trending?limit=20', env);
		const expected = processTrendingVideos(videos, 'hybrid', 20).map((t) => t.videoId);
		assert.deepEqual(res.data.map((v: any) => v.id), expected);
		assert.deepEqual(res.data.map((v: any) => v.trendingMetadata.rank), Array.from({ length: 20 }, (_, i) => i + 1));
	});

	it('by category, each sort, only that category', async () => {
		const { videos, env } = await catalogue(90);
		const category = CATEGORIES[1];
		for (const sort of ['recent', 'popular', 'trending']) {
			const res = await get(`/api/sections/by-category/${category}?limit=50&sort=${sort}`, env);
			assert.ok(res.data.length > 0, sort);
			assert.ok(res.data.every((v: any) => v.category === category), sort);
		}
		const popular = await get(`/api/sections/by-category/${category}?limit=5&sort=popular`, env);
		const expected = videos.filter((v) => v.category === category).sort((a, b) => b.views - a.views || Date.parse(b.dateCreated) - Date.parse(a.dateCreated)).slice(0, 5).map((v) => v.id);
		assert.deepEqual(popular.data.map((v: any) => v.id), expected);
	});

	it('a video made private after it was indexed is not shown (R2 decides)', async () => {
		const { bucket, env } = await catalogue(20);
		const top = (await get('/api/sections/popular?limit=1', env)).data[0].id;
		bucket.store.set(top, JSON.stringify({ ...JSON.parse(bucket.store.get(top)!), isPublic: false }));
		const again = await get('/api/sections/popular?limit=5', env);
		assert.ok(!again.data.some((v: any) => v.id === top));
	});

	it('a page holds at most 50 videos, whatever limit is asked for', async () => {
		const { bucket, env } = await catalogue(120);
		const res = await get('/api/sections/recent?limit=100000', env);
		assert.equal(res.data.length, 50);
		assert.equal(bucket.ops.get, 50);
	});

	it('100 visitors at once: 100 × limit gets, no listing, no index writes', async () => {
		const { bucket, env } = await catalogue(400);
		await Promise.all(Array.from({ length: 100 }, (_, i) => get(`/api/sections/${['popular', 'recent', 'trending'][i % 3]}?limit=10`, env)));
		assert.deepEqual(bucket.ops, { get: 1000, list: 0, put: 0 });
	});
});

describe('home sections without the search index (AV-15)', () => {
	it('serve the stored index even when stale, and never rebuild it', async () => {
		const videos: Record<string, any> = {};
		for (let i = 0; i < 30; i++) videos[video(i).id] = video(i);
		const bucket = new CountingBucket({
			...videos,
			'index:popular-videos:all': {
				type: 'popular', period: 'all', lastUpdated: '2020-01-01T00:00:00.000Z',
				videos: Object.values(videos).slice(0, 10).map((v: any) => ({ videoId: v.id, views: v.views, engagementRate: 0 })),
			},
		});
		const res = await get('/api/sections/popular?limit=5', { videos: bucket });
		assert.equal(res.metadata.fromIndex, true);
		assert.equal(res.data.length, 5);
		assert.equal(bucket.ops.list, 0, 'no scan');
		assert.equal(bucket.ops.put, 0, 'no rebuild');
	});

	it('without any index: one page of the bucket, no rebuild', async () => {
		const videos: Record<string, any> = {};
		for (let i = 0; i < 450; i++) videos[video(i).id] = video(i);
		for (const path of ['/api/sections/popular', '/api/sections/recent', '/api/sections/trending', `/api/sections/by-category/${CATEGORIES[0]}`]) {
			const bucket = new CountingBucket(videos);
			await get(`${path}?limit=10`, { videos: bucket });
			assert.ok(bucket.ops.list <= 2, `${path}: ${bucket.ops.list} lists`);
			assert.equal(bucket.ops.put, 0, `${path}: no rebuild`);
		}
	});
});
