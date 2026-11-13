import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideosList } from '../src/endpoints/video/videoList';
import { changesVideoList, videoListInvalidation } from '../src/lib/videoListCache';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/**
 * The anonymous first page of GET /api/videos is cached on the edge; a delete
 * (or edit, hide, restore...) must drop it at once, not after the TTL: visitors
 * saw deleted videos and their browsers requested thumbnails that 404 (#1131).
 */

/** caches.default in memory (the Workers Cache API surface the edge cache uses) */
class MemoryCache {
	entries = new Map<string, string>();
	async match(url: string) {
		const body = this.entries.get(url);
		return body === undefined ? undefined : new Response(body);
	}
	async put(url: string, res: Response) {
		this.entries.set(url, await res.text());
	}
	async delete(url: string) {
		return this.entries.delete(url);
	}
}

const g = globalThis as unknown as { caches?: { default: MemoryCache } };

function app(videos: MemoryBucket) {
	return buildApp((r: any) => {
		r.use('*', videoListInvalidation);
		r.get('/api/videos', VideosList);
		// Stand-ins for the real handlers: they change the record and answer 200
		r.delete('/api/videos/:id', async (c: any) => {
			const id = c.req.param('id');
			const video = JSON.parse((await (await videos.get(id))!.text()) as string);
			await videos.put(id, JSON.stringify({ ...video, isDeleted: true }));
			return c.json({ success: true });
		});
		r.post('/api/videos/:id/views', async (c: any) => c.json({ success: true }));
	}, null);
}

async function listedIds(a: ReturnType<typeof app>, env: unknown): Promise<string[]> {
	const res = await a.request('/api/videos?limit=10', {}, env as never);
	assert.equal(res.status, 200);
	return ((await res.json()) as { data: Array<{ id: string }> }).data.map((v) => v.id).sort();
}

describe('GET /api/videos first page: dropped from the cache when the list changes', () => {
	let saved: typeof g.caches;
	beforeEach(() => {
		saved = g.caches;
		g.caches = { default: new MemoryCache() };
	});
	afterEach(() => {
		g.caches = saved;
	});

	function setup() {
		const videos = new MemoryBucket({
			a1: videoFixture({ id: 'a1', dateCreated: '2026-11-01T00:00:00.000Z' }),
			a2: videoFixture({ id: 'a2', dateCreated: '2026-11-02T00:00:00.000Z' }),
		});
		return { videos, env: { videos, channels: new MemoryBucket() } };
	}

	it('serves the cached first page while nothing that lists it changed', async () => {
		const { videos, env } = setup();
		const a = app(videos);
		assert.deepEqual(await listedIds(a, env), ['a1', 'a2']);
		// Changed behind the API's back (no list-changing request): the cached page is still served
		await videos.put('a2', JSON.stringify(videoFixture({ id: 'a2', isDeleted: true })));
		assert.equal((await a.request('/api/videos/a1/views', { method: 'POST' }, env as never)).status, 200);
		assert.deepEqual(await listedIds(a, env), ['a1', 'a2']);
	});

	it('a change that arrives on another host still drops the public first page', async () => {
		// Visitors list on the public host; the admin API (service binding) and the local stack's
		// worker-to-worker calls reach the API on other hosts. The bump must not depend on the host.
		const { videos, env } = setup();
		const a = app(videos);
		const publicList = async () => {
			const res = await a.request('https://videos.api.example.test/api/videos?limit=10', {}, env as never);
			return ((await res.json()) as { data: Array<{ id: string }> }).data.map((v) => v.id).sort();
		};
		assert.deepEqual(await publicList(), ['a1', 'a2']);
		const del = await a.request('https://videos.internal/api/videos/a2', { method: 'DELETE' }, env as never);
		assert.equal(del.status, 200);
		assert.deepEqual(await publicList(), ['a1']);
	});

	it('a deleted video is gone from the next anonymous first page', async () => {
		const { videos, env } = setup();
		const a = app(videos);
		assert.deepEqual(await listedIds(a, env), ['a1', 'a2']);
		assert.equal((await a.request('/api/videos/a2', { method: 'DELETE' }, env as never)).status, 200);
		assert.deepEqual(await listedIds(a, env), ['a1']);
	});
});

describe('changesVideoList', () => {
	it('matches the requests that change what the list shows', () => {
		for (const [method, path] of [
			['DELETE', '/api/videos/v1'],
			['PUT', '/api/videos/v1'],
			['DELETE', '/api/videos/v1/permanent'],
			['POST', '/api/videos/v1/restore'],
			['POST', '/api/videos/v1/thumbnail'],
			['POST', '/api/videos/v1/publish-now'],
			['PATCH', '/api/videos/v1/schedule'],
			['PATCH', '/api/videos/bulk'],
			['POST', '/api/videos/bulk-delete'],
			['POST', '/api/videos/bulk/undo'],
			['PUT', '/api/channels/c1'],
			['DELETE', '/api/channels/c1'],
			['POST', '/api/moderation/actions'],
			['POST', '/internal/admin/videos/v1/unpublish'],
			['DELETE', '/internal/admin/deletions/video/v1'],
		]) {
			assert.equal(changesVideoList(method, path), true, `${method} ${path}`);
		}
	});

	it('leaves views, likes, comments, chapters, subtitles and reads alone', () => {
		for (const [method, path] of [
			['GET', '/api/videos/v1'],
			['GET', '/api/videos'],
			['POST', '/api/videos/v1/views'],
			['POST', '/api/videos/v1/likes'],
			['DELETE', '/api/videos/v1/likes'],
			['POST', '/api/videos/v1/comments'],
			['PUT', '/api/videos/v1/chapters'],
			['DELETE', '/api/videos/v1/subtitles/en'],
			['GET', '/internal/admin/videos'],
			['GET', '/api/channels/c1'],
			['POST', '/api/channels/c1/subscriptions'],
		]) {
			assert.equal(changesVideoList(method, path), false, `${method} ${path}`);
		}
	});
});
