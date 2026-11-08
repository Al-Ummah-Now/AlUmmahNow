import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideosList } from '../src/endpoints/video/videoList';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/**
 * GET /api/videos cut the R2 page before filtering out private videos, so a
 * page that happened to hold mostly private/other users' records came back
 * nearly empty: the web home page showed 1-3 videos plus "Load More".
 */
function routes(r: any) {
	r.get('/api/videos', VideosList);
}

describe('GET /api/videos page fill', () => {
	it('keeps reading R2 pages until `limit` visible videos are found, without skipping any', async () => {
		const initial: Record<string, unknown> = {};
		// Keys sort as a0..a5 (private) before b0..b3 (public)
		for (let i = 0; i < 6; i++) initial[`a${i}`] = videoFixture({ id: `a${i}`, isPublic: false });
		for (let i = 0; i < 4; i++) initial[`b${i}`] = videoFixture({ id: `b${i}`, isPublic: true });
		const e = { videos: new MemoryBucket(initial), channels: new MemoryBucket() };
		const app = buildApp(routes, null);

		const first = await app.request('/api/videos?limit=3', {}, e);
		assert.equal(first.status, 200);
		const page1 = (await first.json()) as { data: Array<{ id: string }>; cursor: string };
		assert.ok(page1.data.length >= 3, `first page has ${page1.data.length} videos`);
		assert.ok(page1.data.every((v) => v.id.startsWith('b')), 'only public videos for anonymous viewers');

		const seen = new Set(page1.data.map((v) => v.id));
		let cursor = page1.cursor;
		while (cursor) {
			const res = await app.request(`/api/videos?limit=3&cursor=${encodeURIComponent(cursor)}`, {}, e);
			const page = (await res.json()) as { data: Array<{ id: string }>; cursor: string };
			for (const v of page.data) seen.add(v.id);
			cursor = page.cursor;
		}
		assert.deepEqual([...seen].sort(), ['b0', 'b1', 'b2', 'b3']);
	});
});
