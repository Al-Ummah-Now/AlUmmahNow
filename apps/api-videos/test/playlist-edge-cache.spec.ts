/**
 * GET /api/playlists/:id?includeVideos=true for anonymous viewers is reused on the edge for a short
 * TTL (the playlist page's server render; wiki AUN-SEO TTFB work). Signed-in viewers always read R2.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { PlaylistFetch, EXPANDED_PLAYLIST_TTL_SECONDS } from '../src/endpoints/playlist/playlistFetch';

const OWNER = 'owner';

class FakeCache {
	store = new Map<string, { body: string; cacheControl: string | null }>();
	async match(url: string) {
		const hit = this.store.get(url);
		return hit ? new Response(hit.body) : undefined;
	}
	async put(url: string, res: Response) {
		this.store.set(url, { body: await res.text(), cacheControl: res.headers.get('cache-control') });
	}
	async delete(url: string) {
		return this.store.delete(url);
	}
}

function setup() {
	const playlists = new MemoryBucket({ pl: { id: 'pl', userId: OWNER, channelId: 'ch', title: 'Series', videos: ['v1', 'v2'], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } });
	const videos = new MemoryBucket({
		v1: videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch', title: 'One' }),
		v2: videoFixture({ id: 'v2', userId: OWNER, channelId: 'ch', title: 'Two' }),
	});
	const channels = new MemoryBucket({ ch: { id: 'ch', name: 'Channel', userId: OWNER, email: 'o@test.local', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } });
	return { playlists, videos, channels, queue: new MemoryQueue() };
}

async function get(env: unknown, userId: string | null, path = '/api/playlists/pl?includeVideos=true') {
	const res = await buildApp((r: any) => r.get('/api/playlists/:id', PlaylistFetch), userId ? { userId } : null).request(path, {}, env as never);
	return { status: res.status, body: (await res.json()) as { title?: string; channelName?: string; videoItems?: { id: string; title: string }[] } };
}

describe('anonymous expanded playlist edge cache', () => {
	let cache: FakeCache;
	const g = globalThis as unknown as { caches?: { default: FakeCache } };
	let saved: typeof g.caches;
	beforeEach(() => {
		cache = new FakeCache();
		saved = g.caches;
		g.caches = { default: cache };
	});
	afterEach(() => {
		g.caches = saved;
	});

	it('stores the anonymous answer for a short TTL and serves the next one without R2', async () => {
		const env = setup();
		const first = await get(env, null);
		assert.equal(first.status, 200);
		assert.deepEqual(first.body.videoItems?.map((v) => v.title), ['One', 'Two']);
		assert.equal(first.body.channelName, 'Channel');
		await new Promise((r) => setTimeout(r, 0));
		const [entry] = [...cache.store.values()];
		assert.equal(entry?.cacheControl, `public, max-age=${EXPANDED_PLAYLIST_TTL_SECONDS}`);
		assert.ok(EXPANDED_PLAYLIST_TTL_SECONDS <= 60);

		// R2 changes are not seen by anonymous viewers until the entry expires...
		env.videos.store.set('v1', JSON.stringify(videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch', title: 'Renamed' })));
		env.playlists.store.delete('pl');
		const second = await get(env, null);
		assert.equal(second.status, 200);
		assert.deepEqual(second.body.videoItems?.map((v) => v.title), ['One', 'Two']);
		assert.equal(second.body.channelName, 'Channel');
	});

	it('signed-in viewers always read R2 and never fill the cache', async () => {
		const env = setup();
		await get(env, OWNER);
		assert.equal(cache.store.size, 0);
		await get(env, null);
		env.videos.store.set('v1', JSON.stringify(videoFixture({ id: 'v1', userId: OWNER, channelId: 'ch', title: 'Renamed' })));
		assert.deepEqual((await get(env, OWNER)).body.videoItems?.map((v) => v.title), ['Renamed', 'Two']);
	});

	it('only the expanded read is cached; not-found answers never are', async () => {
		const env = setup();
		await get(env, null, '/api/playlists/pl');
		assert.equal(cache.store.size, 0);
		assert.equal((await get(env, null, '/api/playlists/missing?includeVideos=true')).status, 404);
		assert.equal(cache.store.size, 0);
	});
});
