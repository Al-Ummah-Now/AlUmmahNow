/**
 * The video JSON (`videos/<id>`) has many writers at once. Every writer goes
 * through a conditional write (R2Repository.updateObject), so parallel
 * writers never drop each other's change (SCALABILITY-AUDIT AV-2, AV-3, AV-23).
 *
 * Each test runs dozens of writers in parallel through the real endpoints
 * against a bucket that honours `onlyIf` and interleaves calls, then checks
 * the exact final state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { VideoChaptersUpdate } from '../src/endpoints/video/chaptersUpdate';
import { VideoChaptersGet } from '../src/endpoints/video/chapters';
import { VideoScheduleCreate } from '../src/endpoints/video/scheduleCreate';
import { applyVideoReaction } from '../src/lib/reactions';
import { countView } from '../src/lib/view-counter';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget, updateJson } from '../src/lib/privacy/scan';
import R2Repository, { ConcurrentUpdateError } from '../src/lib/r2Repo';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp, commentFixture, videoFixture } from './helpers';

function env(videos: MemoryBucket, extra: Record<string, unknown> = {}) {
	return {
		videos,
		channels: new MemoryBucket(),
		profiles: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		playlists: new MemoryBucket(),
		community_posts: new MemoryBucket(),
		channel_sections: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		'upload-defaults': new MemoryBucket(),
		reports: new MemoryBucket(),
		queue: new MemoryQueue(),
		...extra,
	};
}

function routes(r: any) {
	r.post('/api/videos/bulk-update', VideoBulkUpdate);
	r.post('/api/videos/:id/comments', CommentCreate);
	r.put('/api/videos/:id/comments/:cid', CommentUpdate);
	r.delete('/api/videos/:id/comments/:cid', CommentDelete);
	r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	r.put('/api/videos/:id/chapters', VideoChaptersUpdate);
	r.get('/api/videos/:id/chapters', VideoChaptersGet);
	r.post('/api/videos/:id/schedule', VideoScheduleCreate);
	r.put('/api/videos/:id', VideoUpdate);
}

const send = (method: string, body: unknown, channelId = 'viewer-ch') => ({
	method,
	headers: { 'Content-Type': 'application/json', channelId },
	body: JSON.stringify(body),
});

function as(userId: string) {
	return buildApp(routes, { userId });
}

describe('video JSON: parallel writers never drop each other’s change', () => {
	it('stores every acknowledged comment, like and view of 120 writers at the same time', async () => {
		const videos = new SlowBucket({ v1: videoFixture() });
		const e = env(videos);
		const N = 40;
		const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
		const [comments, likes, views] = await Promise.all([
			Promise.all(Array.from({ length: N }, (_, i) =>
				as(`commenter-${i}`).request('/api/videos/v1/comments', send('POST', { text: `comment ${i}` }, `ch-${i}`), e)
					.then((r) => r.status === 200 || r.status === 201, () => false))),
			Promise.all(Array.from({ length: N }, (_, i) =>
				ok(applyVideoReaction(new R2Repository<any>(videos as any), 'v1', 'likes', 'add', { userId: `liker-${i}`, channelId: `liker-ch-${i}` })))),
			Promise.all(Array.from({ length: N }, () => ok(countView({ videos: videos as any }, 'v1')))),
		]);

		// A writer that loses every attempt is told so (an error), never acknowledged and dropped
		const acked = (list: boolean[]) => list.filter(Boolean).length;
		const stored = videos.read('v1');
		assert.equal(stored.comments.length, acked(comments), 'every acknowledged comment is stored');
		assert.equal(new Set(stored.comments.map((c: any) => c.text)).size, stored.comments.length);
		assert.equal(stored.likes.length, acked(likes), 'every acknowledged like is stored');
		assert.equal(stored.views, acked(views), 'every acknowledged view is stored');
		assert.ok(acked(comments) + acked(likes) + acked(views) >= 3 * N * 0.9, 'nearly all writers got through');
	});

	it('keeps 30 parallel replies and 30 parallel likes of one comment', async () => {
		const videos = new SlowBucket({ v1: videoFixture({ comments: [commentFixture('top')] }) });
		const e = env(videos);
		const N = 30;
		const statuses = await Promise.all([
			...Array.from({ length: N }, (_, i) =>
				as(`replier-${i}`).request('/api/videos/v1/comments', send('POST', { text: `reply ${i}`, parentCommentId: 'top' }, `r-${i}`), e).then((r) => r.status)),
			...Array.from({ length: N }, (_, i) =>
				as(`fan-${i}`).request('/api/videos/v1/comments/top/likes', send('POST', {}, `fan-ch-${i}`), e).then((r) => r.status)),
		]);
		assert.deepEqual(statuses.filter((s) => s >= 300), []);

		const top = videos.read('v1').comments[0];
		assert.equal(top.replies.length, N);
		assert.equal(top.likes.length, N);
	});

	it('an owner edit, a bulk edit and chapters keep the comments written meanwhile (and vice versa)', async () => {
		const videos = new SlowBucket({ v1: videoFixture({ duration: 600 }) });
		const e = env(videos);
		const owner = as('owner');
		const N = 25;
		const statuses = await Promise.all([
			...Array.from({ length: N }, (_, i) =>
				as(`c-${i}`).request('/api/videos/v1/comments', send('POST', { text: `c ${i}` }, `c-ch-${i}`), e).then((r) => r.status)),
			owner.request('/api/videos/v1', send('PUT', { title: 'Renamed' }, 'owner-ch'), e).then((r) => r.status),
			owner.request('/api/videos/bulk-update', send('POST', { videoIds: ['v1'], changes: { addTags: ['tafsir'] } }, 'owner-ch'), e).then((r) => r.status),
			owner.request('/api/videos/v1/chapters', send('PUT', { chapters: [{ id: '00000000-0000-4000-8000-000000000001', startTime: 0, endTime: 60, title: 'Intro' }] }, 'owner-ch'), e).then((r) => r.status),
		]);
		assert.deepEqual(statuses.filter((s) => s >= 300), []);

		const stored = videos.read('v1');
		assert.equal(stored.comments.length, N, 'no comment lost to the owner’s edits');
		assert.equal(stored.title, 'Renamed', 'the title edit was not reverted');
		assert.deepEqual(stored.tags, ['tafsir'], 'the bulk edit was not reverted');
		assert.equal(stored.hasChapters, true, 'the chapters were not reverted');
	});

	it('parallel edits and deletes of different comments all land', async () => {
		const comments = Array.from({ length: 30 }, (_, i) => commentFixture(`c${i}`, { userId: `author-${i}` }));
		const videos = new SlowBucket({ v1: videoFixture({ comments }) });
		const e = env(videos);
		const statuses = await Promise.all(comments.map((c, i) =>
			i % 2 === 0
				? as(`author-${i}`).request(`/api/videos/v1/comments/${c.id}`, send('PUT', { text: `edited ${i}` }), e).then((r) => r.status)
				: as(`author-${i}`).request(`/api/videos/v1/comments/${c.id}`, send('DELETE', {}), e).then((r) => r.status)));
		assert.deepEqual(statuses.filter((s) => s >= 300), []);

		const stored = videos.read('v1').comments;
		assert.equal(stored.length, 15, 'every delete landed');
		assert.ok(stored.every((c: any) => c.text.startsWith('edited ')), 'every edit landed');
	});

	it('two schedule requests at once: exactly one wins', async () => {
		const videos = new SlowBucket({ v1: videoFixture({ isPublic: false }) });
		const e = env(videos, { SCHEDULED_VIDEOS: new MemoryBucket() });
		const at = new Date(Date.now() + 2 * 3600_000).toISOString();
		const statuses = await Promise.all(Array.from({ length: 10 }, () =>
			as('owner').request('/api/videos/v1/schedule', send('POST', { scheduledPublishDate: at, timezone: 'UTC' }, 'owner-ch'), e).then((r) => r.status)));
		assert.equal(statuses.filter((s) => s < 300).length, 1, 'one request scheduled the video');
		assert.ok(statuses.filter((s) => s >= 300).every((s) => s === 409), 'the others were told it is already scheduled');
	});

	it('the public chapters read never writes the video', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ description: '0:00 Intro\n1:00 Main\n2:00 End', duration: 300 }) });
		const res = await buildApp(routes).request('/api/videos/v1/chapters?regenerate=true', {}, env(videos));
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.chapters.chapters.length, 3);
		assert.equal(videos.versions.get('v1'), undefined, 'no write on a public read');
	});

	it('an edit never re-creates a video deleted meanwhile', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		await videos.delete('v1');
		const res = await as('owner').request('/api/videos/v1', send('PUT', { title: 'x' }, 'owner-ch'), env(videos));
		assert.equal(res.status, 404);
		assert.equal(videos.read('v1'), null);
	});
});

describe('video edit: format', () => {
	it("'short'/'video' is stored and 'auto' removes it again (detection decides)", async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ duration: 4, width: 240, height: 426 }) });
		const e = env(videos);
		const owner = as('owner');
		assert.equal((await owner.request('/api/videos/v1', send('PUT', { format: 'video' }, 'owner-ch'), e)).status, 200);
		assert.equal(videos.read('v1').format, 'video');
		assert.equal((await owner.request('/api/videos/v1', send('PUT', { format: 'auto' }, 'owner-ch'), e)).status, 200);
		assert.equal('format' in videos.read('v1'), false, 'format auto must clear the stored choice');
		assert.equal(videos.read('v1').width, 240, 'other fields are kept');
	});
});

describe('R2Repository.updateObject', () => {
	it('loses no increment with 200 parallel writers', async () => {
		const bucket = new SlowBucket({ k: { n: 0 } });
		const repo = new R2Repository<{ n: number }>(bucket as any);
		await Promise.all(Array.from({ length: 200 }, () => repo.updateObject('k', (d) => { d.n++; }, { maxAttempts: 100 })));
		assert.equal(bucket.read('k').n, 200);
	});

	it('creates a missing object only once when first writers race (create-only put)', async () => {
		const bucket = new SlowBucket();
		const repo = new R2Repository<{ ids: number[] }>(bucket as any);
		await Promise.all(Array.from({ length: 50 }, (_, i) =>
			repo.updateObject('k', (d) => { d.ids.push(i); }, { initial: () => ({ ids: [] }), maxAttempts: 100 })));
		assert.equal(bucket.read('k').ids.length, 50);
	});

	it('throws ConcurrentUpdateError instead of dropping a change when it keeps losing', async () => {
		const bucket = new MemoryBucket({ k: { n: 0 } });
		const repo = new R2Repository<{ n: number }>(bucket as any);
		// Another writer changes the object between every read and write
		const put = bucket.put.bind(bucket);
		bucket.put = async (key: string, value: string, options?: any) => {
			await put(key, JSON.stringify({ n: 100 }));
			return put(key, value, options);
		};
		await assert.rejects(repo.updateObject('k', (d) => { d.n++; }, { maxAttempts: 3 }), ConcurrentUpdateError);
	});
});

describe('erasure rewrites (AV-23)', () => {
	it('anonymising a user’s comments keeps the comments and likes others add meanwhile', async () => {
		const videos = new SlowBucket({
			v1: videoFixture({ userId: 'someone-else', channelId: 'other-ch', comments: [commentFixture('mine', { userId: 'leaver' })] }),
		});
		const N = 20;
		await Promise.all([
			eraseUserData(env(videos) as any, 'leaver', new OperationBudget(10_000)),
			...Array.from({ length: N }, (_, i) =>
				as(`c-${i}`).request('/api/videos/v1/comments', send('POST', { text: `c ${i}` }, `c-ch-${i}`), env(videos)).then((r) => r.status)),
		]);
		const stored = videos.read('v1');
		assert.equal(stored.comments.filter((c: any) => c.text.startsWith('c ')).length, N, 'no comment lost to the erasure');
		assert.ok(stored.comments.every((c: any) => c.userId !== 'leaver'), 'the erasure was not reverted');
	});

	it('updateJson charges every get and put to the budget', async () => {
		const bucket = new MemoryBucket({ k: { n: 1 } });
		const budget = new OperationBudget(10);
		await updateJson<{ n: number }>(bucket, 'k', (v) => { v.n++; }, budget);
		assert.equal(budget.spent, 2);
		assert.equal(bucket.read('k').n, 2);
	});
});
