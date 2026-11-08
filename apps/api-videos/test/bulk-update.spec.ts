/**
 * Epic 5.3: POST /api/videos/bulk-update changes visibility, category and tags
 * of the caller's own videos only, per video, like bulk-delete.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { applyBulkChanges, isEmptyChange, MAX_TAGS } from '../src/lib/bulkEdit';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

function routes(r: any) {
	r.post('/api/videos/bulk-update', VideoBulkUpdate);
}

function bulkUpdate(userId: string | null, body: unknown, videos: MemoryBucket, queue = new MemoryQueue()) {
	return buildApp(routes, userId ? { userId } : null).request(
		'/api/videos/bulk-update',
		{ method: 'POST', headers: { 'Content-Type': 'application/json', channelId: 'owner-ch' }, body: JSON.stringify(body) },
		{ videos, queue },
	);
}

describe('applyBulkChanges', () => {
	const now = '2026-11-08T20:00:00.000Z';
	it('adds tags without duplicates (case-insensitive) and removes by name', () => {
		const r = applyBulkChanges({ tags: ['Tafsir', 'Ramadan'] }, { addTags: ['tafsir', ' Seerah '], removeTags: ['ramadan'] }, now);
		assert.ok(r.ok);
		assert.deepEqual(r.ok && r.video.tags, ['Tafsir', 'Seerah']);
		assert.equal(r.ok && r.video.dateModified, now);
	});

	it('clears the category with null and keeps it when omitted', () => {
		const cleared = applyBulkChanges({ category: 'fiqh' }, { category: null }, now);
		assert.equal(cleared.ok && cleared.video.category, undefined);
		const kept = applyBulkChanges({ category: 'fiqh' }, { isPublic: false }, now);
		assert.equal(kept.ok && kept.video.category, 'fiqh');
	});

	it('reports no change when nothing differs', () => {
		const r = applyBulkChanges({ isPublic: true, tags: ['a'] }, { isPublic: true, addTags: ['A'] }, now);
		assert.ok(r.ok && !r.changed);
		assert.equal(r.ok && r.video.dateModified, undefined);
	});

	it('refuses visibility on scheduled videos and tag overflow', () => {
		assert.deepEqual(applyBulkChanges({ scheduledPublishStatus: 'scheduled' }, { isPublic: true }, now), { ok: false, error: 'scheduled' });
		const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
		assert.deepEqual(applyBulkChanges({ tags: full }, { addTags: ['one-more'] }, now), { ok: false, error: 'too_many_tags' });
	});

	it('detects an empty request', () => {
		assert.equal(isEmptyChange({}), true);
		assert.equal(isEmptyChange({ addTags: [] }), true);
		assert.equal(isEmptyChange({ category: null }), false);
	});
});

describe('POST /api/videos/bulk-update', () => {
	it('edits only the caller\'s videos and reports per video', async () => {
		const videos = new MemoryBucket({
			a: videoFixture({ id: 'a', userId: 'owner', isPublic: false, tags: ['old'] }),
			b: videoFixture({ id: 'b', userId: 'owner', isPublic: true }),
			theirs: videoFixture({ id: 'theirs', userId: 'someone-else', isPublic: false }),
		});
		const queue = new MemoryQueue();
		const res = await bulkUpdate('owner', { videoIds: ['a', 'b', 'theirs', 'missing'], changes: { isPublic: true, category: 'fiqh', addTags: ['Seerah'] } }, videos, queue);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		const byId = Object.fromEntries(body.results.map((r: any) => [r.videoId, r]));
		assert.equal(byId.a.success, true);
		assert.equal(byId.b.success, true);
		assert.match(byId.theirs.error, /^Forbidden/);
		assert.equal(byId.missing.success, false);
		assert.deepEqual(body.summary, { total: 4, succeeded: 2, failed: 2 });

		assert.equal(videos.read('a').isPublic, true);
		assert.equal(videos.read('a').category, 'fiqh');
		assert.deepEqual(videos.read('a').tags, ['old', 'Seerah']);
		assert.equal(videos.read('theirs').isPublic, false, 'another user\'s video is untouched');
		assert.equal(queue.messages.filter((m: any) => m.payload?.videoId).length, 2, 'one VideoEdit per changed video');
	});

	it('400 for a request that changes nothing; 401 without a user', async () => {
		const videos = new MemoryBucket({ a: videoFixture({ id: 'a', userId: 'owner' }) });
		assert.equal((await bulkUpdate('owner', { videoIds: ['a'], changes: {} }, videos)).status, 400);
		assert.notEqual((await bulkUpdate(null, { videoIds: ['a'], changes: { isPublic: false } }, videos)).status, 200);
		assert.equal(videos.read('a').isPublic, true);
	});

	it('rejects an unknown category', async () => {
		const videos = new MemoryBucket({ a: videoFixture({ id: 'a', userId: 'owner' }) });
		assert.equal((await bulkUpdate('owner', { videoIds: ['a'], changes: { category: 'not-a-category' } }, videos)).status, 400);
	});
});
