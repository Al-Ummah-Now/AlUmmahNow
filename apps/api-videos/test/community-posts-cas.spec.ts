/**
 * Community post JSON under concurrent readers and writers
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-8 / AV-9).
 *
 * - Views are D1 counters (analytics_daily, entity_type 'post'); GET never
 *   writes the post JSON, so a view can no longer undo a delete or an edit.
 * - Edits, deletes and the comment counter change only their own field on
 *   the fresh post with a conditional write.
 *
 * Real endpoints against node:sqlite (D1) and an R2 fake that honours
 * `onlyIf` and widens the read → write window (SlowBucket).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetCommunityPost } from '../src/endpoints/community/get-post';
import { ListCommunityPosts } from '../src/endpoints/community/list-posts';
import { UpdateCommunityPost } from '../src/endpoints/community/update-post';
import { DeleteCommunityPost } from '../src/endpoints/community/delete-post';
import { CreatePostComment } from '../src/endpoints/community/post-comment-create';
import { DeletePostComment } from '../src/endpoints/community/post-comment-delete';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'ch';
const OWNER = 'owner';
const KEY = `posts/${CH}/p1.json`;

function routes(r: any) {
	r.get('/api/channels/:channelId/posts', ListCommunityPosts);
	r.get('/api/channels/:channelId/posts/:postId', GetCommunityPost);
	r.put('/api/channels/:channelId/posts/:postId', UpdateCommunityPost);
	r.delete('/api/channels/:channelId/posts/:postId', DeleteCommunityPost);
	r.post('/api/channels/:channelId/posts/:postId/comments', CreatePostComment);
	r.delete('/api/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);
}

function post(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p1', channelId: CH, userId: OWNER, type: 'text', content: 'Original', status: 'published', visibility: 'public',
		commentsEnabled: true, likes: 0, comments: 0, views: 5, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

function env(stored = post()) {
	const channels: Record<string, unknown> = { [CH]: { id: CH, userId: OWNER, name: 'Channel' } };
	for (let i = 0; i < 40; i++) channels[`u${i}-ch`] = { id: `u${i}-ch`, userId: `u${i}`, name: `User ${i}` };
	return {
		community_posts: new SlowBucket({ [KEY]: stored, [`posts/${CH}/index.json`]: { postIds: ['p1'], lastUpdated: '2026-01-01T00:00:00.000Z' } }),
		channels: new MemoryBucket(channels),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	};
}

const anon = buildApp(routes);
const as = (userId: string) => buildApp(routes, { userId });
const json = (channelId?: string) => ({ 'Content-Type': 'application/json', ...(channelId ? { channelId } : {}) });

describe('community post views (AV-8)', () => {
	it('200 parallel views are all counted and the post JSON is never written', async () => {
		const e = env();
		const versionBefore = (await e.community_posts.get(KEY))?.etag;
		const statuses = await Promise.all(Array.from({ length: 200 }, () => anon.request(`/api/channels/${CH}/posts/p1`, {}, e).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200));
		assert.equal((await e.community_posts.get(KEY))?.etag, versionBefore, 'reads do not write the post');
		const view = (await (await anon.request(`/api/channels/${CH}/posts/p1`, {}, e)).json()) as any;
		assert.equal(view.views, 5 + 201, 'legacy 5 + every view');
		const listed = (await (await anon.request(`/api/channels/${CH}/posts`, {}, e)).json()) as any;
		assert.equal(listed.posts[0].views, 206, 'the list shows the same total');
	});

	it('views during a delete and an edit never undo them', async () => {
		const e = env();
		await Promise.all([
			...Array.from({ length: 30 }, () => anon.request(`/api/channels/${CH}/posts/p1`, {}, e)),
			as(OWNER).request(`/api/channels/${CH}/posts/p1`, { method: 'PUT', headers: json(CH), body: JSON.stringify({ content: 'Edited' }) }, e),
		]);
		assert.equal(e.community_posts.read(KEY).content, 'Edited');
		await Promise.all([
			...Array.from({ length: 30 }, () => anon.request(`/api/channels/${CH}/posts/p1`, {}, e)),
			as(OWNER).request(`/api/channels/${CH}/posts/p1`, { method: 'DELETE', headers: json(CH) }, e),
		]);
		assert.equal(e.community_posts.read(KEY).status, 'deleted', 'the delete stays');
		assert.equal((await anon.request(`/api/channels/${CH}/posts/p1`, {}, e)).status, 404);
	});
});

describe('community post writers (AV-9)', () => {
	it('40 parallel comments count exactly while the owner edits', async () => {
		const e = env();
		const statuses = await Promise.all([
			...Array.from({ length: 40 }, (_, i) =>
				as(`u${i}`).request(`/api/channels/${CH}/posts/p1/comments`, { method: 'POST', headers: json(`u${i}-ch`), body: JSON.stringify({ content: `Comment ${i}` }) }, e).then((r) => r.status)),
			as(OWNER).request(`/api/channels/${CH}/posts/p1`, { method: 'PUT', headers: json(CH), body: JSON.stringify({ content: 'Edited' }) }, e).then((r) => r.status),
		]);
		assert.ok(statuses.every((s) => s < 300), statuses.join());
		const stored = e.community_posts.read(KEY);
		assert.equal(stored.comments, 40, 'every comment counted');
		assert.equal(stored.content, 'Edited', 'the edit is kept');
	});

	it('parallel comment creates and deletes end at the exact count', async () => {
		const e = env();
		const created: string[] = [];
		for (let i = 0; i < 20; i++) {
			const res = await as(`u${i}`).request(`/api/channels/${CH}/posts/p1/comments`, { method: 'POST', headers: json(`u${i}-ch`), body: JSON.stringify({ content: `C${i}` }) }, e);
			const body = (await res.json()) as any;
			created.push(body.comment?.id ?? body.result?.comment?.id ?? body.data?.id);
		}
		assert.ok(created.every(Boolean), 'comment ids returned');
		await Promise.all([
			...created.slice(0, 10).map((id, i) => as(`u${i}`).request(`/api/channels/${CH}/posts/p1/comments/${id}`, { method: 'DELETE', headers: json(`u${i}-ch`) }, e)),
			...Array.from({ length: 15 }, (_, i) =>
				as(`u${20 + i}`).request(`/api/channels/${CH}/posts/p1/comments`, { method: 'POST', headers: json(`u${20 + i}-ch`), body: JSON.stringify({ content: `N${i}` }) }, e)),
		]);
		assert.equal(e.community_posts.read(KEY).comments, 20 - 10 + 15);
	});

	it('an edit of a deleted post is a 404 and the post stays deleted', async () => {
		const e = env(post({ status: 'deleted' }));
		const res = await as(OWNER).request(`/api/channels/${CH}/posts/p1`, { method: 'PUT', headers: json(CH), body: JSON.stringify({ content: 'Back?' }) }, e);
		assert.equal(res.status, 404);
		assert.equal(e.community_posts.read(KEY).status, 'deleted');
		assert.equal(e.community_posts.read(KEY).content, 'Original');
	});
});
