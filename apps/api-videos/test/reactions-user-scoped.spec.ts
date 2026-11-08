import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { channelIdMiddleware } from '../src/middleware/auth';
import { LikeCreate } from '../src/endpoints/video/videoLikeCreate';
import { LikeDelete } from '../src/endpoints/video/videoLikeDelete';
import { DislikeCreate } from '../src/endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../src/endpoints/video/videoDislikeDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { CommentDislikeCreate } from '../src/endpoints/video/commentDislikeCreate';
import { VideoCreate } from '../src/endpoints/video/videoCreate';
import { MemoryBucket, MemoryQueue, commentFixture, videoFixture } from './helpers';

/**
 * #305: removing a dislike that does not exist threw a TypeError (500)
 *       instead of being a no-op; add/remove must be idempotent and must not
 *       queue an event when nothing changed.
 * #292: a member without a channel reacts as themselves (the web sends their
 *       user id as `channelId`). The global channelIdMiddleware answered 404
 *       "Channel not found" because that id is not a channel.
 */

const USER = 'usr_member';

/** Mirrors index.ts: auth context, then channelIdMiddleware on /api/*. */
function appWith(register: (r: any) => void, userId: string | null = USER) {
	const app = new Hono();
	app.use('*', async (c, next) => {
		if (userId) {
			c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
			c.set('userId' as never, userId as never);
		}
		await next();
	});
	app.use('/api/*', channelIdMiddleware);
	const router = fromHono(app);
	register(router);
	return app;
}

function routes(r: any) {
	r.post('/api/videos/:id/likes', LikeCreate);
	r.delete('/api/videos/:id/likes', LikeDelete);
	r.post('/api/videos/:id/dislikes', DislikeCreate);
	r.delete('/api/videos/:id/dislikes', DislikeDelete);
	r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	r.post('/api/videos/:id/comments/:cid/dislikes', CommentDislikeCreate);
	r.post('/api/videos', VideoCreate);
}

function env(video = videoFixture()) {
	return {
		videos: new MemoryBucket({ [video.id as string]: video }),
		channels: new MemoryBucket({ 'my-ch': { id: 'my-ch', userId: USER } }),
		queue: new MemoryQueue(),
	};
}

describe('idempotent video reactions (#305)', () => {
	it('removing a dislike that does not exist is a 200 no-op without a queue event', async () => {
		const e = env();
		const res = await appWith(routes).request('/api/videos/v1/dislikes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal((await res.json() as any).success, true);
		assert.equal(e.queue.messages.length, 0);
	});

	it('removing a like that does not exist is a 200 no-op without a queue event', async () => {
		const e = env();
		const res = await appWith(routes).request('/api/videos/v1/likes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(e.queue.messages.length, 0);
	});

	it('handles a stored video with no likes/dislikes arrays', async () => {
		const video = videoFixture();
		delete (video as any).likes;
		delete (video as any).dislikes;
		const e = env(video);
		const app = appWith(routes);
		for (const [method, path] of [['DELETE', 'dislikes'], ['DELETE', 'likes'], ['POST', 'dislikes'], ['POST', 'likes']]) {
			const res = await app.request(`/api/videos/v1/${path}`, { method, headers: { channelId: 'my-ch' } }, e);
			assert.ok(res.status < 300, `${method} ${path}: ${res.status} ${await res.clone().text()}`);
		}
	});

	it('adding the same like or dislike twice stores one and queues one event', async () => {
		const e = env();
		const app = appWith(routes);
		for (const path of ['likes', 'likes', 'dislikes', 'dislikes']) {
			const res = await app.request(`/api/videos/v1/${path}`, { method: 'POST', headers: { channelId: 'my-ch' } }, e);
			assert.ok(res.status < 300, `${path}: ${res.status}`);
		}
		const stored = e.videos.read('v1');
		assert.equal(stored.likes.length, 1);
		assert.equal(stored.dislikes.length, 1);
		assert.equal(e.queue.messages.length, 2);
	});

	it('removing twice queues one event', async () => {
		const e = env();
		const app = appWith(routes);
		await app.request('/api/videos/v1/dislikes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		await app.request('/api/videos/v1/dislikes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		const again = await app.request('/api/videos/v1/dislikes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(again.status, 200);
		assert.equal(e.videos.read('v1').dislikes.length, 0);
		assert.equal(e.queue.messages.length, 2);
	});
});

describe('members without a channel react as themselves (#292)', () => {
	it('likes and unlikes a video with their user id as channelId', async () => {
		const e = env();
		const app = appWith(routes);
		const like = await app.request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: USER } }, e);
		assert.ok(like.status < 300, `like: ${like.status} ${await like.clone().text()}`);
		assert.deepEqual(e.videos.read('v1').likes.map((l: any) => [l.userId, l.channelId]), [[USER, USER]]);

		const unlike = await app.request('/api/videos/v1/likes', { method: 'DELETE', headers: { channelId: USER } }, e);
		assert.equal(unlike.status, 200);
		assert.equal(e.videos.read('v1').likes.length, 0);
	});

	it('dislikes a video with no channelId header at all', async () => {
		const e = env();
		const res = await appWith(routes).request('/api/videos/v1/dislikes', { method: 'POST' }, e);
		assert.ok(res.status < 300, `dislike: ${res.status} ${await res.clone().text()}`);
		assert.deepEqual(e.videos.read('v1').dislikes.map((d: any) => d.channelId), [USER]);
	});

	it('likes and dislikes a comment as themselves', async () => {
		const e = env(videoFixture({ comments: [commentFixture('c1')] }));
		const app = appWith(routes);
		const like = await app.request('/api/videos/v1/comments/c1/likes', { method: 'POST', headers: { channelId: USER } }, e);
		assert.equal(like.status, 200, await like.clone().text());
		assert.equal((await like.json() as any).result.isLiked, true);
		const dislike = await app.request('/api/videos/v1/comments/c1/dislikes', { method: 'POST' }, e);
		assert.equal(dislike.status, 200, await dislike.clone().text());
	});

	it('cannot react as another user', async () => {
		const e = env();
		const res = await appWith(routes).request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'usr_someone_else' } }, e);
		assert.equal(res.status, 404);
		assert.equal(e.videos.read('v1').likes.length, 0);
	});

	it('still needs a real channel for channel-owned actions like creating a video', async () => {
		const e = env();
		const res = await appWith(routes).request('/api/videos', {
			method: 'POST',
			headers: { channelId: USER, 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'x' }),
		}, e);
		assert.equal(res.status, 404, await res.clone().text());
	});
});
