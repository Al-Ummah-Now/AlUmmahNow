/**
 * GET /api/channels/:id for anonymous viewers reuses the built view (it saves the D1 counts) while the
 * stored channel's version matches (the channel page's server render; wiki AUN-SEO TTFB work). The
 * channel is read from R2 and its visibility checked every time: moderation applies at once.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { ChannelFetch, CHANNEL_VIEW_TTL_SECONDS } from '../src/endpoints/channel/channelFetch';

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

	it('stores the anonymous view for a short TTL and reuses it while the channel is unchanged', async () => {
		const env = setup();
		assert.equal((await get(env, null, '/api/channels/ch')).body.name, 'Channel');
		await settle();
		const [entry] = [...cache.store.values()];
		assert.equal(entry?.cacheControl, `public, max-age=${CHANNEL_VIEW_TTL_SECONDS}`);
		assert.ok(CHANNEL_VIEW_TTL_SECONDS <= 60);
		assert.ok(!/"email"\s*:/.test(entry!.body), 'the stored view is the public one');
		// Same version in R2: the cached view answers (a changed field without a new dateModified is not seen)
		env.channels.store.set('ch', JSON.stringify(channel({ description: 'unseen' })));
		const cached = await get(env, null, '/api/channels/ch');
		assert.equal(cached.status, 200);
		assert.ok(!JSON.stringify(cached.body).includes('unseen'));
		// A new version is built fresh
		env.channels.store.set('ch', JSON.stringify(channel({ name: 'Renamed', dateModified: '2026-02-01T00:00:00.000Z' })));
		assert.equal((await get(env, null, '/api/channels/ch')).body.name, 'Renamed');
	});

	it('suspension, deletion and a private switch are a 404 at once, whatever the cache holds', async () => {
		for (const flag of ['isHidden', 'isDeleted', 'isPrivate']) {
			cache.store.clear();
			const env = setup();
			assert.equal((await get(env, null, '/api/channels/ch')).status, 200);
			await settle();
			assert.equal(cache.store.size, 1);
			env.channels.store.set('ch', JSON.stringify(channel({ [flag]: true })));
			assert.equal((await get(env, null, '/api/channels/ch')).status, 404, flag);
		}
		const env = setup();
		await get(env, null, '/api/channels/ch');
		env.channels.store.delete('ch');
		assert.equal((await get(env, null, '/api/channels/ch')).status, 404);
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

});
