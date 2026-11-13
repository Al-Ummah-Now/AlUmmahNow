/**
 * Scheduled community posts go live (#1218, lib/scheduled-posts.ts): a time-sorted marker per
 * scheduled post; the every-minute cron publishes due ones, announces them, and drops stale markers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket } from './helpers';
import { isUpcoming, markScheduled, parseMarkerKey, publishDuePosts, scheduleMarkerKey } from '../src/lib/scheduled-posts';

const post = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, channelId: 'c1', userId: 'u1', type: 'text', content: 'x', status: 'scheduled', scheduledAt: at, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

describe('scheduled community posts', () => {
	it('marker keys sort by time and parse back', () => {
		const k = scheduleMarkerKey('2026-11-13T10:00:00Z', 'c1', 'p1')!;
		assert.equal(k, 'scheduled-posts/2026-11-13T10:00:00.000Z/c1/p1');
		assert.deepEqual(parseMarkerKey(k), { at: '2026-11-13T10:00:00.000Z', channelId: 'c1', postId: 'p1' });
		assert.equal(scheduleMarkerKey('nope', 'c1', 'p1'), null);
		assert.equal(scheduleMarkerKey('2026-11-13T10:00:00Z', '../x', 'p1'), null);
	});

	it('hides upcoming posts until their time', () => {
		const now = Date.parse('2026-11-13T10:00:00Z');
		assert.equal(isUpcoming({ status: 'scheduled' as never, scheduledAt: '2026-11-13T11:00:00Z' }, now), true);
		assert.equal(isUpcoming({ status: 'scheduled' as never, scheduledAt: '2026-11-13T09:00:00Z' }, now), false);
		assert.equal(isUpcoming({ status: 'published' as never, scheduledAt: '2026-11-13T11:00:00Z' }, now), false);
	});

	it('publishes due posts once, announces them, keeps later ones, drops stale markers', async () => {
		const b = new MemoryBucket() as unknown as R2Bucket;
		const sent: unknown[] = [];
		const queue = { send: async (m: unknown) => void sent.push(m) };
		await b.put('posts/c1/due.json', JSON.stringify(post('due', '2026-11-13T09:59:00.000Z')));
		await b.put('posts/c1/later.json', JSON.stringify(post('later', '2026-11-13T12:00:00.000Z')));
		await b.put('posts/c1/moved.json', JSON.stringify(post('moved', '2026-11-13T15:00:00.000Z')));
		await b.put('posts/c1/index.json', JSON.stringify({ postIds: ['old'], lastUpdated: '' }));
		await markScheduled(b, 'c1', 'due', '2026-11-13T09:59:00.000Z');
		await markScheduled(b, 'c1', 'later', '2026-11-13T12:00:00.000Z');
		await markScheduled(b, 'c1', 'moved', '2026-11-13T09:00:00.000Z'); // rescheduled to 15:00 since
		await markScheduled(b, 'c1', 'gone', '2026-11-13T09:30:00.000Z'); // deleted meanwhile
		const r = await publishDuePosts({ community_posts: b, queue }, new Date('2026-11-13T10:00:00Z'));
		assert.deepEqual(r, { published: 1, dropped: 2 });
		const due = (await (await b.get('posts/c1/due.json'))!.json()) as Record<string, unknown>;
		assert.equal(due.status, 'published');
		assert.equal(due.createdAt, '2026-11-13T09:59:00.000Z');
		assert.equal(((await (await b.get('posts/c1/moved.json'))!.json()) as Record<string, unknown>).status, 'scheduled');
		assert.deepEqual(((await (await b.get('posts/c1/index.json'))!.json()) as { postIds: string[] }).postIds, ['due', 'old']);
		assert.equal(sent.length, 1);
		const left = (await b.list({ prefix: 'scheduled-posts/' })).objects.map((o) => o.key);
		assert.deepEqual(left, ['scheduled-posts/2026-11-13T12:00:00.000Z/c1/later']);
		// Running again changes nothing
		assert.deepEqual(await publishDuePosts({ community_posts: b, queue }, new Date('2026-11-13T10:01:00Z')), { published: 0, dropped: 0 });
	});
});
