/** Creator deletes are soft: restorable for 30 days, then queued or due for the cleanup (lib/creatorDeletions.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoDelete } from '../src/endpoints/video/videoDelete';
import { VideoBulkDelete } from '../src/endpoints/video/videoBulkDelete';
import { ChannelDeletedVideos, VideoBulkPurge, VideoBulkRestore } from '../src/endpoints/video/videoTrash';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const json = { 'Content-Type': 'application/json', channelId: 'ch1' };

function env() {
	return {
		SEARCH_DB: new SqliteD1(),
		videos: new MemoryBucket({
			a: videoFixture({ id: 'a', title: 'Lesson A', userId: 'owner', channelId: 'ch1' }),
			b: videoFixture({ id: 'b', title: 'Lesson B', userId: 'owner', channelId: 'ch1', uploadedBy: 'editor' }),
			theirs: videoFixture({ id: 'theirs', userId: 'other', channelId: 'ch2' }),
		}),
		channels: new MemoryBucket({
			ch1: { id: 'ch1', userId: 'owner', name: 'C1', members: [{ userId: 'editor', role: 'editor', addedAt: '2026-01-01T00:00:00.000Z', addedBy: 'owner' }] },
			ch2: { id: 'ch2', userId: 'other', name: 'C2' },
		}),
		queue: new MemoryQueue(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
	};
}

function app(userId: string) {
	return buildApp((r: any) => {
		r.delete('/api/videos/:id', VideoDelete);
		r.post('/api/videos/bulk-delete', VideoBulkDelete);
		r.post('/api/videos/bulk-restore', VideoBulkRestore);
		r.post('/api/videos/bulk-purge', VideoBulkPurge);
		r.get('/api/channels/:id/content/deleted', ChannelDeletedVideos);
	}, { userId });
}

const stored = (e: ReturnType<typeof env>, id: string) => JSON.parse(e.videos.store.get(id) as string);
const post = (e: ReturnType<typeof env>, userId: string, path: string, body: unknown) =>
	app(userId).request(path, { method: 'POST', headers: json, body: JSON.stringify(body) }, e as never);

describe('creator soft delete', () => {
	it('DELETE keeps the video, hidden and restorable, and erases nothing yet', async () => {
		const e = env();
		const res = await app('owner').request('/api/videos/a', { method: 'DELETE', headers: { channelId: 'ch1' } }, e as never);
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored(e, 'a').isDeleted, true);
		assert.equal(e.PROCESSING_CHECK_QUEUE.messages.length, 0, 'no Bunny delete before the cleanup');
		const row = await e.SEARCH_DB.prepare('SELECT kind, deleted_by, channel_id FROM admin_deletions WHERE target_id = ?').bind('a').first<any>();
		assert.deepEqual({ ...row }, { kind: 'video', deleted_by: 'owner', channel_id: 'ch1' });
	});

	it('bulk delete is soft and refuses videos the caller may not delete', async () => {
		const e = env();
		const res = await post(e, 'owner', '/api/videos/bulk-delete', { videoIds: ['a', 'theirs'] });
		const body = (await res.json()) as any;
		assert.deepEqual(body.summary, { total: 2, succeeded: 1, failed: 1 });
		assert.equal(stored(e, 'a').isDeleted, true);
		assert.notEqual(stored(e, 'theirs').isDeleted, true);
	});

	it('an editor deletes only their own uploads', async () => {
		const e = env();
		const body = (await (await post(e, 'editor', '/api/videos/bulk-delete', { videoIds: ['a', 'b'] })).json()) as any;
		assert.deepEqual(body.results.map((r: any) => [r.videoId, r.success]), [['a', false], ['b', true]]);
	});

	it('lists the channel\'s deleted videos, restores one and queues another', async () => {
		const e = env();
		await post(e, 'owner', '/api/videos/bulk-delete', { videoIds: ['a', 'b'] });

		const listed = (await (await app('owner').request('/api/channels/ch1/content/deleted', {}, e as never)).json()) as any;
		assert.deepEqual(listed.result.items.map((i: any) => i.id).sort(), ['a', 'b']);
		assert.ok(listed.result.items.every((i: any) => i.status === 'deleted' && i.purgeAfter > i.deletedAt));

		const restored = (await (await post(e, 'owner', '/api/videos/bulk-restore', { videoIds: ['a'] })).json()) as any;
		assert.equal(restored.summary.succeeded, 1);
		assert.equal(stored(e, 'a').isDeleted, false);

		const purged = (await (await post(e, 'owner', '/api/videos/bulk-purge', { videoIds: ['b'] })).json()) as any;
		assert.equal(purged.summary.succeeded, 1);
		const after = (await (await app('owner').request('/api/channels/ch1/content/deleted', {}, e as never)).json()) as any;
		assert.deepEqual(after.result.items.map((i: any) => [i.id, i.status]), [['b', 'queued']]);
	});

	it('someone without a role on the channel can\'t list, restore or purge', async () => {
		const e = env();
		await post(e, 'owner', '/api/videos/bulk-delete', { videoIds: ['a'] });
		assert.equal((await app('other').request('/api/channels/ch1/content/deleted', {}, e as never)).status, 403);
		const restored = (await (await post(e, 'other', '/api/videos/bulk-restore', { videoIds: ['a'] })).json()) as any;
		assert.equal(restored.summary.failed, 1);
		const purged = (await (await post(e, 'other', '/api/videos/bulk-purge', { videoIds: ['a'] })).json()) as any;
		assert.equal(purged.summary.failed, 1);
		assert.equal(stored(e, 'a').isDeleted, true);
	});
});
