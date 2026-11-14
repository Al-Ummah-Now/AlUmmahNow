/**
 * GET /api/channels/:id and GET /api/channels/:id/tabs for anonymous viewers are reused on the edge for
 * a short TTL (the channel page's server render; wiki AUN-SEO TTFB work). Signed-in viewers always
 * read R2, and private or missing channels are never stored.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { ChannelFetch, CHANNEL_VIEW_TTL_SECONDS } from '../src/endpoints/channel/channelFetch';
import { ChannelTabsFetch, CHANNEL_TABS_TTL_SECONDS } from '../src/endpoints/channel/channelTabsFetch';

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

const channel = (over: Record<string, unknown> = {}) => ({ id: 'ch', name: 'Channel', userId: OWNER, email: 'o@test.local', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...over });
const tabs = (defaultTab: string) => ({ channelId: 'ch', defaultTab, tabs: [], version: 1, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' });

function setup(over: Record<string, unknown> = {}) {
	return {
		channels: new MemoryBucket({ ch: channel(over) }),
		channel_tabs: new MemoryBucket({ 'channel-tabs/ch': tabs('videos') }),
		profiles: new MemoryBucket({}),
		videos: new MemoryBucket({}),
		queue: new MemoryQueue(),
	};
}

const app = (userId: string | null) =>
	buildApp((r: any) => {
		r.get('/api/channels/:id/tabs', ChannelTabsFetch);
		r.get('/api/channels/:id', ChannelFetch);
	}, userId ? { userId } : null);

async function get(env: unknown, userId: string | null, path: string) {
	const res = await app(userId).request(path, {}, env as never);
	return { status: res.status, body: (await res.json()) as { name?: string; defaultTab?: string } };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('anonymous channel edge cache', () => {
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

	it('stores the anonymous channel view for a short TTL and serves the next one without R2', async () => {
		const env = setup();
		assert.equal((await get(env, null, '/api/channels/ch')).body.name, 'Channel');
		await settle();
		const [entry] = [...cache.store.values()];
		assert.equal(entry?.cacheControl, `public, max-age=${CHANNEL_VIEW_TTL_SECONDS}`);
		assert.ok(CHANNEL_VIEW_TTL_SECONDS <= 60);
		assert.ok(!/"email"\s*:/.test(entry!.body), 'the stored view is the public one');
		env.channels.store.delete('ch');
		const second = await get(env, null, '/api/channels/ch');
		assert.equal(second.status, 200);
		assert.equal(second.body.name, 'Channel');
	});

	it('signed-in viewers read R2 and never fill the cache; private and missing channels are never stored', async () => {
		const env = setup();
		await get(env, OWNER, '/api/channels/ch');
		assert.equal(cache.store.size, 0);
		await get(env, null, '/api/channels/ch');
		await settle();
		env.channels.store.set('ch', JSON.stringify(channel({ name: 'Renamed' })));
		assert.equal((await get(env, OWNER, '/api/channels/ch')).body.name, 'Renamed');

		cache.store.clear();
		const privateEnv = setup({ isPrivate: true });
		assert.equal((await get(privateEnv, null, '/api/channels/ch')).status, 404);
		assert.equal((await get(privateEnv, null, '/api/channels/missing')).status, 404);
		await settle();
		assert.equal(cache.store.size, 0);
	});

	it('tabs: the anonymous config is stored for a short TTL; signed-in readers and missing channels bypass it', async () => {
		const env = setup();
		assert.equal((await get(env, null, '/api/channels/ch/tabs')).body.defaultTab, 'videos');
		await settle();
		const [entry] = [...cache.store.values()];
		assert.equal(entry?.cacheControl, `public, max-age=${CHANNEL_TABS_TTL_SECONDS}`);
		assert.ok(CHANNEL_TABS_TTL_SECONDS <= 60);

		env.channel_tabs.store.set('channel-tabs/ch', JSON.stringify(tabs('shorts')));
		assert.equal((await get(env, null, '/api/channels/ch/tabs')).body.defaultTab, 'videos');
		assert.equal((await get(env, OWNER, '/api/channels/ch/tabs')).body.defaultTab, 'shorts');

		cache.store.clear();
		assert.equal((await get(env, null, '/api/channels/missing/tabs')).status, 404);
		for (const flag of ['isPrivate', 'isHidden', 'isDeleted']) await get(setup({ [flag]: true }), null, '/api/channels/ch/tabs');
		await settle();
		assert.equal(cache.store.size, 0);
	});
});
