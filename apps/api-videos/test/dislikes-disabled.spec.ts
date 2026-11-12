import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISLIKES_DISABLED_CODE, DISLIKES_DISABLED_MESSAGE } from '@al-ummah/shared-types';
import { LikeCreate } from '../src/endpoints/video/videoLikeCreate';
import { DislikeCreate } from '../src/endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../src/endpoints/video/videoDislikeDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { CommentDislikeCreate } from '../src/endpoints/video/commentDislikeCreate';
import { CommentDislikeDelete } from '../src/endpoints/video/commentDislikeDelete';
import { CommentList } from '../src/endpoints/video/commentList';
import { sortComments, toCommentListItem, withoutDislikes } from '../src/lib/comments';
import { MessageType } from '../src/lib/queue';
import { publicVideoFields, transformVideoToView } from '../src/lib/transformations';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';

/**
 * Owner decisions 2026-11-11 (videos) and 2026-11-12 (comments): dislikes are
 * hidden and not accepted.
 * POST /:id/dislikes answers 410 dislikes_disabled and stores nothing; an old
 * dislike can still be cleared (DELETE, or by liking); public payloads never
 * show or count stored dislikes.
 */

function routes(r: any) {
	r.post('/api/videos/:id/likes', LikeCreate);
	r.post('/api/videos/:id/dislikes', DislikeCreate);
	r.delete('/api/videos/:id/dislikes', DislikeDelete);
}

const OLD_DISLIKE = { id: 'd-old', userId: 'me', channelId: 'my-ch', entityId: 'v1', dateCreated: '2026-01-01T00:00:00.000Z' };

function withOldDislike() {
	const video = videoFixture();
	(video as any).dislikes = [OLD_DISLIKE];
	return video;
}

describe('dislikes are turned off (2026-11-11)', () => {
	it('POST /:id/dislikes is 410 Gone with code dislikes_disabled, stores nothing and queues nothing', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'me' }).request('/api/videos/v1/dislikes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 410);
		const body = await res.json() as any;
		assert.equal(body.success, false);
		assert.equal(body.code, DISLIKES_DISABLED_CODE);
		assert.equal(body.code, 'dislikes_disabled');
		assert.equal(body.error, 'Dislikes are turned off');
		assert.deepEqual(body.messages, { en: 'Dislikes are turned off', ar: 'تم إيقاف عدم الإعجاب' });
		assert.deepEqual(videos.read('v1').dislikes, []);
		assert.equal(e.queue.messages.length, 0);
	});

	it('answers in Arabic with ?lang=ar', async () => {
		const e = { videos: new MemoryBucket({ v1: videoFixture() }), queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'me' }).request('/api/videos/v1/dislikes?lang=ar', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 410);
		assert.equal((await res.json() as any).error, DISLIKES_DISABLED_MESSAGE.ar);
	});

	it('is 410 even for a video that does not exist (nothing is looked up)', async () => {
		const e = { videos: new MemoryBucket({}), queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'me' }).request('/api/videos/nope/dislikes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 410);
	});

	it('an old dislike can still be removed', async () => {
		const videos = new MemoryBucket({ v1: withOldDislike() });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'me' }).request('/api/videos/v1/dislikes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(videos.read('v1').dislikes, []);
		assert.deepEqual(e.queue.messages.map((m) => m.type), [MessageType.VideoUndislike]);
	});

	it('liking clears the member\'s old dislike in the same write and queues the undislike', async () => {
		const videos = new MemoryBucket({ v1: withOldDislike() });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(routes, { userId: 'me' }).request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		const stored = videos.read('v1');
		assert.deepEqual(stored.dislikes, []);
		assert.deepEqual(stored.likes.map((l: any) => l.channelId), ['my-ch']);
		assert.deepEqual(e.queue.messages.map((m) => m.type).sort(), [MessageType.VideoLike, MessageType.VideoUndislike].sort());
	});

	it('liking leaves other members\' old dislikes alone', async () => {
		const video = withOldDislike();
		(video as any).dislikes.push({ ...OLD_DISLIKE, id: 'd-other', userId: 'other', channelId: 'other-ch' });
		const videos = new MemoryBucket({ v1: video });
		const e = { videos, queue: new MemoryQueue() };
		await buildApp(routes, { userId: 'me' }).request('/api/videos/v1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.deepEqual(videos.read('v1').dislikes.map((d: any) => d.id), ['d-other']);
	});

	it('public video payloads never show or count stored dislikes', () => {
		const video = withOldDislike();
		const view = transformVideoToView(video as never, null) as any;
		assert.equal(view.dislikesCount, 0);
		assert.deepEqual(view.dislikes, []);
		assert.deepEqual((publicVideoFields(video as never) as any).dislikes, []);
	});
});

function commentRoutes(r: any) {
	r.get('/api/videos/:id/comments', CommentList);
	r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	r.post('/api/videos/:id/comments/:cid/dislikes', CommentDislikeCreate);
	r.delete('/api/videos/:id/comments/:cid/dislikes', CommentDislikeDelete);
}

const OLD_COMMENT_DISLIKE = { id: 'cd-old', userId: 'me', channelId: 'my-ch', entityId: 'v1:c1', dateCreated: '2026-01-01T00:00:00.000Z' };

function videoWithDislikedComment() {
	return videoFixture({
		comments: [commentFixture('c1', {
			dislikes: [OLD_COMMENT_DISLIKE, { ...OLD_COMMENT_DISLIKE, id: 'cd-other', userId: 'other', channelId: 'other-ch' }],
			replies: [commentFixture('r1', { parentCommentId: 'c1', dislikes: [{ ...OLD_COMMENT_DISLIKE, id: 'rd-old' }] })],
		})],
	});
}

describe('comment dislikes are turned off (2026-11-12)', () => {
	it('POST /:id/comments/:cid/dislikes is 410 dislikes_disabled, stores nothing and queues nothing', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('c1')] }) });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments/c1/dislikes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 410);
		const body = await res.json() as any;
		assert.equal(body.code, 'dislikes_disabled');
		assert.equal(body.error, 'Dislikes are turned off');
		assert.deepEqual(body.messages, DISLIKES_DISABLED_MESSAGE);
		assert.deepEqual(videos.read('v1').comments[0].dislikes, []);
		assert.equal(e.queue.messages.length, 0);
	});

	it('answers in Arabic with ?lang=ar', async () => {
		const e = { videos: new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('c1')] }) }), queue: new MemoryQueue() };
		const res = await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments/c1/dislikes?lang=ar', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 410);
		assert.equal((await res.json() as any).error, 'تم إيقاف عدم الإعجاب');
	});

	it('an old comment dislike can still be removed, and the answer shows no dislikes', async () => {
		const videos = new MemoryBucket({ v1: videoWithDislikedComment() });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments/c1/dislikes', { method: 'DELETE', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		const body = await res.json() as any;
		assert.equal(body.result.dislikesCount, 0);
		assert.equal(body.result.isDisliked, false);
		assert.deepEqual(videos.read('v1').comments[0].dislikes.map((d: any) => d.id), ['cd-other']);
		assert.deepEqual(e.queue.messages.map((m) => m.type), [MessageType.CommentUndislike]);
	});

	it('liking a comment clears the member\'s old dislike on it and queues like + undislike', async () => {
		const videos = new MemoryBucket({ v1: videoWithDislikedComment() });
		const e = { videos, queue: new MemoryQueue() };
		const res = await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments/c1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		const body = await res.json() as any;
		assert.deepEqual(body.result, { commentId: 'c1', likesCount: 1, dislikesCount: 0, isLiked: true, isDisliked: false });
		const stored = videos.read('v1').comments[0];
		assert.deepEqual(stored.dislikes.map((d: any) => d.id), ['cd-other'], 'other members\' dislikes stay (historical data)');
		assert.deepEqual(e.queue.messages.map((m) => m.type).sort(), [MessageType.CommentLike, MessageType.CommentUndislike].sort());
	});

	it('liking a comment already liked only clears the old dislike: no second like event', async () => {
		const video = videoWithDislikedComment();
		(video as any).comments[0].likes = [{ id: 'l-old', userId: 'me', channelId: 'my-ch', entityId: 'v1:c1', dateCreated: '2026-01-01T00:00:00.000Z' }];
		const videos = new MemoryBucket({ v1: video });
		const e = { videos, queue: new MemoryQueue() };
		await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments/c1/likes', { method: 'POST', headers: { channelId: 'my-ch' } }, e);
		assert.deepEqual(e.queue.messages.map((m) => m.type), [MessageType.CommentUndislike]);
		assert.equal(videos.read('v1').comments[0].likes.length, 1);
	});

	it('the comment list shows no dislikes (0 / false) even for the member who left one', async () => {
		const e = { videos: new MemoryBucket({ v1: videoWithDislikedComment() }), queue: new MemoryQueue(), channels: new MemoryBucket({}), profiles: new MemoryBucket({}) };
		const res = await buildApp(commentRoutes, { userId: 'me' }).request('/api/videos/v1/comments', { headers: { channelId: 'my-ch' } }, e);
		assert.equal(res.status, 200, await res.clone().text());
		const body = await res.json() as any;
		const items = body.result?.comments ?? body.result?.items ?? body.comments;
		assert.ok(Array.isArray(items) && items.length === 1, JSON.stringify(body).slice(0, 300));
		assert.equal(items[0].dislikesCount, 0);
		assert.equal(items[0].isDisliked, false);
	});

	it('public payloads empty comment and reply dislikes, and top ranks by likes only', () => {
		const video = videoWithDislikedComment();
		const view = transformVideoToView(video as never, null) as any;
		assert.deepEqual(view.comments[0].dislikes, []);
		assert.deepEqual(view.comments[0].replies[0].dislikes, []);
		assert.deepEqual((publicVideoFields(video as never) as any).comments[0].dislikes, []);
		assert.deepEqual(withoutDislikes(video.comments[0] as never).dislikes, []);
		assert.equal(toCommentListItem(video.comments[0] as never, { userId: 'u1', channelId: 'ch1', displayName: '' }, 'my-ch').isDisliked, false);

		// Two likes and three dislikes outranks one like and none: dislikes do not count
		const a = commentFixture('a', { likes: [{ id: '1', channelId: 'x' }, { id: '2', channelId: 'y' }], dislikes: [{ id: '3' }, { id: '4' }, { id: '5' }], dateCreated: '2026-01-01T00:00:00.000Z' });
		const b = commentFixture('b', { likes: [{ id: '6', channelId: 'z' }], dateCreated: '2026-01-02T00:00:00.000Z' });
		assert.deepEqual(sortComments([b, a] as never, 'top').map((c: any) => c.id), ['a', 'b']);
	});
});
