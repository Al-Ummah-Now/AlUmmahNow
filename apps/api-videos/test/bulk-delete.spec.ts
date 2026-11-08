/**
 * POST /api/videos/bulk-delete must check the owner of every video it is
 * given (prod hotfix 380db16): the channelId header alone proves nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoBulkDelete } from '../src/endpoints/video/videoBulkDelete';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

function routes(r: any) {
	r.post('/api/videos/bulk-delete', VideoBulkDelete);
}

function bulkDelete(app: ReturnType<typeof buildApp>, videoIds: string[], videos: MemoryBucket, queue: MemoryQueue) {
	return app.request(
		'/api/videos/bulk-delete',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', channelId: 'owner-ch' },
			body: JSON.stringify({ videoIds }),
		},
		{ videos, queue },
	);
}

describe('POST /api/videos/bulk-delete ownership', () => {
	it('deletes only the caller\'s own videos and refuses the rest', async () => {
		const videos = new MemoryBucket({
			mine: videoFixture({ id: 'mine', userId: 'owner' }),
			theirs: videoFixture({ id: 'theirs', userId: 'someone-else', channelId: 'other-ch' }),
		});
		const queue = new MemoryQueue();
		const res = await bulkDelete(buildApp(routes, { userId: 'owner' }), ['mine', 'theirs', 'missing'], videos, queue);

		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		const byId = Object.fromEntries(body.results.map((r: any) => [r.videoId, r]));
		assert.equal(byId.mine.success, true);
		assert.equal(byId.theirs.success, false);
		assert.match(byId.theirs.error, /^Forbidden/);
		assert.equal(byId.missing.success, false);
		assert.deepEqual(body.summary, { total: 3, succeeded: 1, failed: 2 });

		assert.equal(videos.read('mine'), null);
		assert.notEqual(videos.read('theirs'), null, 'another user\'s video must survive');
		assert.equal(queue.messages.length, 1, 'only the owned video is queued for deletion');
	});

	it('deletes nothing for an intruder holding the owner\'s channelId', async () => {
		const videos = new MemoryBucket({
			a: videoFixture({ id: 'a', userId: 'owner' }),
			b: videoFixture({ id: 'b', userId: 'owner' }),
		});
		const queue = new MemoryQueue();
		const res = await bulkDelete(buildApp(routes, { userId: 'intruder' }), ['a', 'b'], videos, queue);

		const body = (await res.json()) as any;
		assert.deepEqual(body.summary, { total: 2, succeeded: 0, failed: 2 });
		assert.notEqual(videos.read('a'), null);
		assert.notEqual(videos.read('b'), null);
		assert.equal(queue.messages.length, 0);
	});

	it('deletes nothing without an authenticated user', async () => {
		const videos = new MemoryBucket({ a: videoFixture({ id: 'a', userId: 'owner' }) });
		const queue = new MemoryQueue();
		const res = await bulkDelete(buildApp(routes, null), ['a'], videos, queue);

		assert.notEqual(res.status, 200);
		assert.notEqual(videos.read('a'), null);
		assert.equal(queue.messages.length, 0);
	});
});
