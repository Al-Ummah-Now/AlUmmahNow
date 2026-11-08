import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecentVideosSection } from '../src/endpoints/sections/recent';
import { PopularVideosSection } from '../src/endpoints/sections/popular';
import { TrendingVideosSection } from '../src/endpoints/sections/trending';
import { RecommendedVideosSection } from '../src/endpoints/sections/recommended';
import { CategoryVideosSection } from '../src/endpoints/sections/by-category';
import { MemoryBucket, buildApp, videoFixture } from './helpers';

/**
 * #304: GET /api/videos/sections/recommended answered 500 on every call, on
 * prod and QA, signed in or not. Its schema declared `headers: z.object({})`,
 * which chanfana validates against `null`, so validation always threw and the
 * handler's catch-all returned 500 with the raw Zod issues.
 *
 * A home-page shelf must degrade to an empty list, never a 500.
 */

function sectionRoutes(r: any) {
	r.get('/api/videos/sections/recent', RecentVideosSection);
	r.get('/api/videos/sections/popular', PopularVideosSection);
	r.get('/api/videos/sections/trending', TrendingVideosSection);
	r.get('/api/videos/sections/recommended', RecommendedVideosSection);
	r.get('/api/videos/sections/by-category/:category', CategoryVideosSection);
}

const SHELVES = [
	'/api/videos/sections/recent',
	'/api/videos/sections/popular',
	'/api/videos/sections/trending',
	'/api/videos/sections/recommended?limit=12&strategy=popular&excludeWatched=false',
	'/api/videos/sections/by-category/fiqh',
];

/** A bucket whose every operation fails, like an R2 outage. */
class BrokenBucket extends MemoryBucket {
	async get(): Promise<any> { throw new Error('R2 unavailable'); }
	async list(): Promise<any> { throw new Error('R2 unavailable'); }
}

describe('recommended shelf (#304)', () => {
	it('answers 200 with videos for a signed-out visitor', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ views: 5 }) });
		const app = buildApp(sectionRoutes, null);
		const res = await app.request(SHELVES[3], {}, { videos });
		assert.equal(res.status, 200, await res.clone().text());
		const body = await res.json() as any;
		assert.equal(body.success, true);
		assert.deepEqual(body.data.map((v: any) => v.id), ['v1']);
	});

	it('answers 200 for a signed-in member', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const app = buildApp(sectionRoutes, { userId: 'me' });
		const res = await app.request(`${SHELVES[3].split('?')[0]}?excludeWatched=true`, {}, { videos, watch_history: new MemoryBucket() });
		assert.equal(res.status, 200, await res.clone().text());
	});
});

describe('home shelves degrade instead of failing', () => {
	it('still rejects a malformed query with 400, not 500', async () => {
		const app = buildApp(sectionRoutes, null);
		const res = await app.request('/api/videos/sections/recommended?strategy=bogus', {}, { videos: new MemoryBucket() });
		assert.equal(res.status, 400);
	});

	for (const path of SHELVES) {
		it(`${path.split('?')[0]} answers 200 with an empty list when storage fails`, async () => {
			const app = buildApp(sectionRoutes, null);
			const broken = new BrokenBucket();
			const res = await app.request(path, {}, { videos: broken, trending: broken, analytics: broken });
			const text = await res.clone().text();
			assert.equal(res.status, 200, text);
			const body = await res.json() as any;
			assert.equal(body.success, true);
			assert.deepEqual(body.data, []);
			assert.ok(!text.includes('R2 unavailable'), 'internal error text must not reach the client');
		});
	}
});
