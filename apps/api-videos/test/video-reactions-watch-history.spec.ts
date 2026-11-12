import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LikeCreate } from '../src/endpoints/video/videoLikeCreate';
import { LikeDelete } from '../src/endpoints/video/videoLikeDelete';
import { DislikeCreate } from '../src/endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../src/endpoints/video/videoDislikeDelete';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import R2Repository from '../src/lib/r2Repo';

/**
 * Regressions found by the watch page / history E2E specs:
 * - video like / unlike / remove-dislike stored the change and then answered
 *   500 (the handler returned a bare `true`), so the web app treated every
 *   reaction as failed;
 * - POST /api/watch-history and POST /api/watch-history/:id/progress read the
 *   body a second time after validation and always answered 500, so watch
 *   history was never recorded.
 */

function reactionRoutes(r: any) {
	r.post('/api/videos/:id/likes', LikeCreate);
	r.delete('/api/videos/:id/likes', LikeDelete);
	r.post('/api/videos/:id/dislikes', DislikeCreate);
	r.delete('/api/videos/:id/dislikes', DislikeDelete);
}

function historyRoutes(r: any) {
	r.post('/api/watch-history', RecordWatchHistory);
	r.post('/api/watch-history/:videoId/progress', UpdateWatchProgress);
}

describe('video likes / dislikes', () => {
	it('like, unlike and remove dislike answer 2xx and update the video; dislike is refused (410)', async () => {
		const stored = videoFixture();
		(stored as any).dislikes = [{ id: 'd-old', userId: 'me', channelId: 'my-ch', entityId: 'v1', dateCreated: '2026-01-01T00:00:00.000Z' }];
		const videos = new MemoryBucket({ v1: stored });
		const e = { videos, queue: new MemoryQueue() };
		const app = buildApp(reactionRoutes, { userId: 'me' });
		const headers = { channelId: 'my-ch' };

		const dislike = await app.request('/api/videos/v1/dislikes', { method: 'POST', headers }, e);
		assert.equal(dislike.status, 410);
		assert.equal(videos.read('v1').dislikes.length, 1, 'a refused dislike stores nothing');

		const undislike = await app.request('/api/videos/v1/dislikes', { method: 'DELETE', headers }, e);
		assert.ok(undislike.status < 300, `remove dislike status ${undislike.status}`);
		assert.equal(videos.read('v1').dislikes.length, 0);

		const like = await app.request('/api/videos/v1/likes', { method: 'POST', headers }, e);
		assert.ok(like.status < 300, `like status ${like.status}`);
		assert.equal((await like.json() as any).success, true);
		assert.deepEqual(videos.read('v1').likes.map((l: any) => l.channelId), ['my-ch']);

		const unlike = await app.request('/api/videos/v1/likes', { method: 'DELETE', headers }, e);
		assert.ok(unlike.status < 300, `unlike status ${unlike.status}`);
		assert.equal(videos.read('v1').likes.length, 0);
	});
});

describe('concurrent reactions', () => {
	it('two channels liking the same video at once both keep their like', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		// Interleave: both requests read the video before either writes it
		const realGet = videos.get.bind(videos);
		let reads = 0;
		let release: () => void = () => undefined;
		const bothRead = new Promise<void>((r) => { release = r; });
		videos.get = async (key: string) => {
			const obj = await realGet(key);
			if (++reads === 2) release();
			if (reads <= 2) await bothRead;
			return obj;
		};
		const e = { videos, queue: new MemoryQueue() };
		const a = buildApp(reactionRoutes, { userId: 'alice' });
		const b = buildApp(reactionRoutes, { userId: 'bob' });

		const [ra, rb] = await Promise.all([
			a.request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'ch-a' } }, e),
			b.request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'ch-b' } }, e),
		]);
		assert.ok(ra.status < 300 && rb.status < 300, `statuses ${ra.status} ${rb.status}`);
		assert.deepEqual(videos.read('v1').likes.map((l: any) => l.channelId).sort(), ['ch-a', 'ch-b']);
	});
});

describe('R2Repository.updateObject', () => {
	it('re-applies a change that lost the race instead of overwriting the other one (post index)', async () => {
		const bucket = new MemoryBucket({ 'posts/c1/index.json': { postIds: ['old'] } });
		const repo = new R2Repository<{ postIds: string[] }>(bucket as unknown as R2Bucket);
		const add = (id: string) => repo.updateObject('posts/c1/index.json', (index) => {
			index.postIds = [id, ...index.postIds];
		});
		await Promise.all([add('p1'), add('p2'), add('p3')]);
		assert.deepEqual([...bucket.read('posts/c1/index.json').postIds].sort(), ['old', 'p1', 'p2', 'p3']);
	});

	it('creates a missing object from `initial` and returns null without it', async () => {
		const bucket = new MemoryBucket();
		const repo = new R2Repository<{ postIds: string[] }>(bucket as unknown as R2Bucket);
		assert.equal(await repo.updateObject('missing', () => true), null);
		await repo.updateObject('posts/c2/index.json', (i) => { i.postIds.push('p1'); }, { initial: () => ({ postIds: [] }) });
		assert.deepEqual(bucket.read('posts/c2/index.json').postIds, ['p1']);
	});
});

describe('watch history recording', () => {
	it('records a view and then updates its progress', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ title: 'Lecture', channelName: 'Chan' }) });
		const history = new MemoryBucket();
		const e = { videos, watch_history: history, queue: new MemoryQueue() };
		const app = buildApp(historyRoutes, { userId: 'me' });
		const json = { 'Content-Type': 'application/json' };

		const record = await app.request('/api/watch-history', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ videoId: 'v1', progress: 30, duration: 100 }),
		}, e);
		assert.equal(record.status, 201, await record.clone().text());
		const entry = history.read('me:v1');
		assert.equal(entry.videoTitle, 'Lecture');
		assert.equal(entry.percentageWatched, 30);

		const progress = await app.request('/api/watch-history/v1/progress', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ progress: 96, duration: 100 }),
		}, e);
		assert.ok(progress.status < 300, `progress status ${progress.status}: ${await progress.clone().text()}`);
		assert.equal(history.read('me:v1').completed, true);
	});
});
