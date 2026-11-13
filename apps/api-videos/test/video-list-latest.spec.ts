import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideosList } from '../src/endpoints/video/videoList';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { MemoryBucket, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

/**
 * GET /api/videos without a channel (the home grid and "All videos") read the videos bucket in key
 * order (random UUIDs), stopped at `limit` visible videos and sorted only that page: the "latest
 * videos" were whichever keys came first, and a new upload landed on any page (#1029). With a
 * complete ownership index the list is the catalogue's newest videos, page after page.
 */
function routes(r: any) {
	r.get('/api/videos', VideosList);
}

function bucketData() {
	const videos: Record<string, unknown> = {};
	// 40 older public videos whose keys sort first
	for (let i = 0; i < 40; i++) {
		const id = `a${String(i).padStart(3, '0')}`;
		videos[id] = videoFixture({ id, channelId: `ch-${i % 3}`, dateCreated: new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString() });
	}
	// The newest public videos, with keys that sort last
	videos['z-newest'] = videoFixture({ id: 'z-newest', channelId: 'ch-1', dateCreated: '2026-11-12T10:00:00.000Z' });
	videos['m-second'] = videoFixture({ id: 'm-second', channelId: 'ch-2', dateCreated: '2026-11-11T10:00:00.000Z' });
	// Newer still, but never listed: private, processing, deleted, hidden
	videos['n-private'] = videoFixture({ id: 'n-private', isPublic: false, dateCreated: '2026-11-13T10:00:00.000Z' });
	videos['n-processing'] = videoFixture({ id: 'n-processing', uploadStatus: 'processing', dateCreated: '2026-11-13T10:00:00.000Z' });
	videos['n-deleted'] = videoFixture({ id: 'n-deleted', isDeleted: true, dateCreated: '2026-11-13T10:00:00.000Z' });
	videos['n-hidden'] = videoFixture({ id: 'n-hidden', isHidden: true, dateCreated: '2026-11-13T10:00:00.000Z' });
	return videos;
}

async function indexedEnv() {
	const db = new SqliteD1();
	const env = { SEARCH_DB: db, videos: new MemoryBucket(bucketData()), channels: new MemoryBucket() };
	await runOwnershipPass(env as never, 'video', { maxPages: 50 });
	return env;
}

async function page(app: ReturnType<typeof buildApp>, url: string, env: unknown) {
	const res = await app.request(url, {}, env as never);
	assert.equal(res.status, 200, url);
	return (await res.json()) as { data: Array<{ id: string }>; cursor: string };
}

describe('GET /api/videos (no channel): newest first across the catalogue', () => {
	it('starts with the newest listed videos, whatever their keys', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const first = await page(app, '/api/videos?limit=5', env);
		assert.deepEqual(first.data.slice(0, 2).map((v) => v.id), ['z-newest', 'm-second']);
		assert.ok(first.cursor, 'more pages follow');
	});

	it('pages through every listed video once, newest to oldest', async () => {
		const env = await indexedEnv();
		const app = buildApp(routes, null);
		const seen: string[] = [];
		let cursor = '';
		for (let i = 0; i < 20; i++) {
			const p = await page(app, `/api/videos?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, env);
			seen.push(...p.data.map((v) => v.id));
			cursor = p.cursor;
			if (!cursor) break;
		}
		assert.equal(seen.length, 42);
		assert.equal(new Set(seen).size, 42, 'no video twice');
		assert.ok(!seen.some((id) => id.startsWith('n-')), 'private, processing, deleted and hidden videos are not listed');
	});

	it('falls back to the bucket scan without an index', async () => {
		const env = { videos: new MemoryBucket(bucketData()), channels: new MemoryBucket() };
		const app = buildApp(routes, null);
		const first = await page(app, '/api/videos?limit=5', env);
		assert.equal(first.data.length, 5);
	});
});
