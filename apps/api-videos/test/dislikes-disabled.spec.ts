import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DISLIKES_DISABLED_CODE, DISLIKES_DISABLED_MESSAGE } from '@al-ummah/shared-types';
import { LikeCreate } from '../src/endpoints/video/videoLikeCreate';
import { DislikeCreate } from '../src/endpoints/video/videoDislikeCreate';
import { DislikeDelete } from '../src/endpoints/video/videoDislikeDelete';
import { MessageType } from '../src/lib/queue';
import { publicVideoFields, transformVideoToView } from '../src/lib/transformations';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/**
 * Owner decision 2026-11-11: dislikes are hidden and not accepted.
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
