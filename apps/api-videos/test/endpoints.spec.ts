import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { CommentLikeDelete } from '../src/endpoints/video/commentLikeDelete';
import { CommentDislikeCreate } from '../src/endpoints/video/commentDislikeCreate';
import { SubscriptionStatus } from '../src/endpoints/channel/SubscriptionStatus';
import { SubscriptionCreate } from '../src/endpoints/channel/SubscriptionCreate';
import { SubscriptionDelete } from '../src/endpoints/channel/SubscriptionDelete';
import { SubscriptionFeed } from '../src/endpoints/channel/SubscriptionFeed';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';

function env(buckets: Partial<Record<'videos' | 'channels' | 'profiles', MemoryBucket>> = {}) {
	return {
		videos: buckets.videos ?? new MemoryBucket(),
		channels: buckets.channels ?? new MemoryBucket(),
		profiles: buckets.profiles ?? new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

function commentRoutes(r: any) {
	r.get('/api/videos/:id/comments', CommentList);
	r.post('/api/videos/:id/comments', CommentCreate);
	r.put('/api/videos/:id/comments/:cid', CommentUpdate);
	r.delete('/api/videos/:id/comments/:cid', CommentDelete);
	r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	r.delete('/api/videos/:id/comments/:cid/likes', CommentLikeDelete);
	r.post('/api/videos/:id/comments/:cid/dislikes', CommentDislikeCreate);
}

describe('GET /api/videos/:id/comments', () => {
	it('lists comments newest first with author info from channels and profiles', async () => {
		const videos = new MemoryBucket({
			v1: videoFixture({
				comments: [
					commentFixture('old', { channelId: 'ch1', userId: 'u1', dateCreated: '2026-01-01T00:00:00Z' }),
					commentFixture('new', { channelId: 'gone', userId: 'u2', dateCreated: '2026-01-02T00:00:00Z', likes: [{ id: 'l', userId: 'me', channelId: 'my-ch' }] }),
				],
			}),
		});
		const channels = new MemoryBucket({ ch1: { id: 'ch1', name: 'Channel One', avatarUrl: 'one.png' } });
		const profiles = new MemoryBucket({ u2: { id: 'u2', displayName: 'User Two', avatarUrl: 'two.png' } });
		const app = buildApp(commentRoutes, { userId: 'me' });

		const res = await app.request('/api/videos/v1/comments', { headers: { channelId: 'my-ch' } }, env({ videos, channels, profiles }));
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		assert.equal(body.success, true);
		assert.deepEqual(body.result.comments.map((c: any) => c.id), ['new', 'old']);
		assert.equal(body.result.comments[0].author.displayName, 'User Two');
		assert.equal(body.result.comments[0].author.avatarUrl, 'two.png');
		assert.equal(body.result.comments[0].isLiked, true);
		assert.equal(body.result.comments[1].author.displayName, 'Channel One');
		assert.equal(body.result.total, 2);
	});

	it('supports limit/cursor pagination', async () => {
		const comments = Array.from({ length: 5 }, (_, i) => commentFixture(`c${i}`, { dateCreated: `2026-01-0${i + 1}T00:00:00Z` }));
		const app = buildApp(commentRoutes, null);
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ comments }) }) });
		const first = await (await app.request('/api/videos/v1/comments?limit=2', {}, e)).json() as any;
		assert.deepEqual(first.result.comments.map((c: any) => c.id), ['c4', 'c3']);
		assert.equal(first.result.nextCursor, '2');
		const second = await (await app.request(`/api/videos/v1/comments?limit=2&cursor=${first.result.nextCursor}`, {}, e)).json() as any;
		assert.deepEqual(second.result.comments.map((c: any) => c.id), ['c2', 'c1']);
	});

	it('returns 404 for hidden or private videos', async () => {
		const app = buildApp(commentRoutes, null);
		const e = env({ videos: new MemoryBucket({ h: videoFixture({ id: 'h', isHidden: true }), p: videoFixture({ id: 'p', isPublic: false }) }) });
		assert.equal((await app.request('/api/videos/h/comments', {}, e)).status, 404);
		assert.equal((await app.request('/api/videos/p/comments', {}, e)).status, 404);
		assert.equal((await app.request('/api/videos/missing/comments', {}, e)).status, 404);
	});
});

describe('POST /api/videos/:id/comments', () => {
	it('accepts `content` from the web client and stores reaction arrays', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const channels = new MemoryBucket({ 'my-ch': { id: 'my-ch', name: 'Mine' } });
		const app = buildApp(commentRoutes, { userId: 'me' });
		const res = await app.request('/api/videos/v1/comments', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: 'my-ch' },
			body: JSON.stringify({ content: '  hello  ' }),
		}, env({ videos, channels }));
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		assert.equal(body.result.comment.text, 'hello');
		assert.equal(body.result.comment.author.displayName, 'Mine');
		const stored = videos.read('v1').comments[0];
		assert.deepEqual(stored.likes, []);
		assert.deepEqual(stored.dislikes, []);
	});

	it('rejects empty text', async () => {
		const app = buildApp(commentRoutes, { userId: 'me' });
		const res = await app.request('/api/videos/v1/comments', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: 'my-ch' },
			body: JSON.stringify({ text: '   ' }),
		}, env({ videos: new MemoryBucket({ v1: videoFixture() }) }));
		assert.equal(res.status, 400);
	});
});

describe('comment ownership', () => {
	it('forbids editing or deleting another user\'s comment', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('c1', { userId: 'author' })] }) });
		const app = buildApp(commentRoutes, { userId: 'intruder' });
		const e = env({ videos });
		const put = await app.request('/api/videos/v1/comments/c1', {
			method: 'PUT', headers: { 'Content-Type': 'application/json', channelId: 'x' }, body: JSON.stringify({ text: 'hacked' }),
		}, e);
		assert.equal(put.status, 403);
		const del = await app.request('/api/videos/v1/comments/c1', { method: 'DELETE', headers: { channelId: 'x' } }, e);
		assert.equal(del.status, 403);
		assert.equal(videos.read('v1').comments.length, 1);
	});

	it('lets the video owner delete a comment', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('c1', { userId: 'author' })] }) });
		const app = buildApp(commentRoutes, { userId: 'owner' });
		const del = await app.request('/api/videos/v1/comments/c1', { method: 'DELETE', headers: { channelId: 'owner-ch' } }, env({ videos }));
		assert.equal(del.status, 200);
		assert.equal(videos.read('v1').comments.length, 0);
	});
});

describe('comment like/dislike', () => {
	it('updates the COMMENT (not the video) and keeps reactions exclusive', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('c1')] }) });
		const app = buildApp(commentRoutes, { userId: 'me' });
		const e = env({ videos });

		const like = await app.request('/api/videos/v1/comments/c1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(like.status, 200);
		const likeBody = await like.json() as any;
		assert.deepEqual(likeBody.result, { commentId: 'c1', likesCount: 1, dislikesCount: 0, isLiked: true, isDisliked: false });
		assert.equal(videos.read('v1').likes.length, 0, 'video likes must be untouched');

		const dislike = await app.request('/api/videos/v1/comments/c1/dislikes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		const dislikeBody = await dislike.json() as any;
		assert.equal(dislikeBody.result.likesCount, 0);
		assert.equal(dislikeBody.result.dislikesCount, 1);

		const unlike = await app.request('/api/videos/v1/comments/c1/likes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(unlike.status, 200, 'removing a non-existent like must not crash');
		assert.equal(e.queue.messages.length, 2);
	});

	it('returns 404 for an unknown comment', async () => {
		const app = buildApp(commentRoutes, { userId: 'me' });
		const res = await app.request('/api/videos/v1/comments/nope/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, env({ videos: new MemoryBucket({ v1: videoFixture() }) }));
		assert.equal(res.status, 404);
	});

	it('requires authentication', async () => {
		const app = buildApp(commentRoutes, null);
		const res = await app.request('/api/videos/v1/comments/c1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, env());
		assert.equal(res.status, 401);
	});
});

function subscriptionRoutes(r: any) {
	r.get('/api/channels/:id/subscriptions/status', SubscriptionStatus);
	r.post('/api/channels/:id/subscriptions', SubscriptionCreate);
	r.delete('/api/channels/:id/subscriptions', SubscriptionDelete);
	r.get('/api/profile/subscriptions/feed', SubscriptionFeed);
}

describe('subscriptions', () => {
	it('subscribes to the TARGET channel, reports status, and unsubscribes', async () => {
		const channels = new MemoryBucket({
			target: { id: 'target', userId: 'creator', name: 'Target', subscriptions: [] },
			'my-ch': { id: 'my-ch', userId: 'me', name: 'Mine', subscriptions: [] },
		});
		const profiles = new MemoryBucket({ me: { id: 'me', subscribedTo: [] } });
		const app = buildApp(subscriptionRoutes, { userId: 'me' });
		const e = env({ channels, profiles });

		let status = await (await app.request('/api/channels/target/subscriptions/status', { headers: { channelId: 'my-ch' } }, e)).json() as any;
		assert.equal(status.result.isSubscribed, false);

		const sub = await app.request('/api/channels/target/subscriptions', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(sub.status, 201);
		const subBody = await sub.json() as any;
		assert.equal(subBody.success, true);
		assert.equal(subBody.result.subscriberCount, 1);
		assert.equal(channels.read('target').name, 'Target', 'target channel must not be overwritten');
		assert.equal(channels.read('target').subscriptions.length, 1);
		assert.equal(channels.read('my-ch').subscriptions.length, 0);
		assert.deepEqual(profiles.read('me').subscribedTo, ['target']);

		status = await (await app.request('/api/channels/target/subscriptions/status', { headers: { channelId: 'my-ch' } }, e)).json() as any;
		assert.equal(status.result.isSubscribed, true);

		const unsub = await app.request('/api/channels/target/subscriptions', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(unsub.status, 200);
		assert.equal(channels.read('target').subscriptions.length, 0);
		assert.deepEqual(profiles.read('me').subscribedTo, []);

		// Unsubscribing again must not crash
		assert.equal((await app.request('/api/channels/target/subscriptions', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e)).status, 200);
	});

	it('reports not subscribed for anonymous viewers', async () => {
		const channels = new MemoryBucket({ target: { id: 'target', subscriptions: [{ id: 's', userId: 'x', channelId: 'y' }] } });
		const app = buildApp(subscriptionRoutes, null);
		const body = await (await app.request('/api/channels/target/subscriptions/status', {}, env({ channels }))).json() as any;
		assert.deepEqual(body.result, { channelId: 'target', isSubscribed: false, subscriberCount: 1 });
	});

	it('returns a newest-first feed of subscribed channel videos', async () => {
		const videos = new MemoryBucket({
			a: videoFixture({ id: 'a', channelId: 's1', dateCreated: '2026-01-01T00:00:00Z' }),
			b: videoFixture({ id: 'b', channelId: 's1', dateCreated: '2026-01-03T00:00:00Z' }),
			c: videoFixture({ id: 'c', channelId: 'other', dateCreated: '2026-01-04T00:00:00Z' }),
			d: videoFixture({ id: 'd', channelId: 's1', dateCreated: '2026-01-05T00:00:00Z', isHidden: true }),
		});
		const channels = new MemoryBucket({ s1: { id: 's1', name: 'Sub One', avatarUrl: 's1.png' } });
		const profiles = new MemoryBucket({ me: { id: 'me', subscribedTo: ['s1'] } });
		const app = buildApp(subscriptionRoutes, { userId: 'me' });
		const res = await app.request('/api/profile/subscriptions/feed?limit=10', {}, env({ videos, channels, profiles }));
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		assert.deepEqual(body.data.map((v: any) => v.id), ['b', 'a']);
		assert.equal(body.data[0].channelName, 'Sub One');
		assert.equal(body.data[0].comments, undefined);
	});
});

describe('GET /api/videos/search', () => {
	it('excludes moderation-hidden and deleted videos', async () => {
		const videos = new MemoryBucket({
			ok: videoFixture({ id: 'ok', title: 'quran recitation' }),
			hid: videoFixture({ id: 'hid', title: 'quran hidden', isHidden: true }),
			del: videoFixture({ id: 'del', title: 'quran deleted', isDeleted: true }),
		});
		const app = buildApp((r) => r.get('/api/videos/search', VideoSearch), null);
		const res = await app.request('/api/videos/search?q=quran', {}, env({ videos }));
		assert.equal(res.status, 200);
		const text = await res.text();
		assert.ok(text.includes('"ok"'));
		assert.ok(!text.includes('"hid"'));
		assert.ok(!text.includes('"del"'));
	});
});
