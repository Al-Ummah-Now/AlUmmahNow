/**
 * Community comments under concurrent writers
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-10 / AV-11 / AV-12).
 *
 * - Comment indexes change with a conditional write: every comment is listed.
 * - A comment's likes are recounted from its like records inside a
 *   conditional write: exact under concurrent and duplicate likes / unlikes.
 * - Replies count, heart, edit and delete change the fresh comment.
 * - The pinned pointer decides which comment is pinned: two pins at once
 *   leave exactly one.
 *
 * Real endpoints against an R2 fake that honours `onlyIf` and widens the
 * read → write window (SlowBucket).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreatePostComment } from '../src/endpoints/community/post-comment-create';
import { DeletePostComment } from '../src/endpoints/community/post-comment-delete';
import { UpdatePostComment } from '../src/endpoints/community/post-comment-update';
import { LikePostComment } from '../src/endpoints/community/post-comment-like';
import { UnlikePostComment } from '../src/endpoints/community/post-comment-unlike';
import { HeartPostComment } from '../src/endpoints/community/post-comment-heart';
import { PinPostComment } from '../src/endpoints/community/post-comment-pin';
import { ListPostComments } from '../src/endpoints/community/post-comments-list';
import { ListPostCommentReplies } from '../src/endpoints/community/post-comment-replies-list';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'ch';
const OWNER = 'owner';
const POST_KEY = `posts/${CH}/p1.json`;
const BASE = `/api/channels/${CH}/posts/p1/comments`;

function routes(r: any) {
	r.get('/api/channels/:channelId/posts/:postId/comments', ListPostComments);
	r.post('/api/channels/:channelId/posts/:postId/comments', CreatePostComment);
	r.put('/api/channels/:channelId/posts/:postId/comments/:commentId', UpdatePostComment);
	r.delete('/api/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);
	r.post('/api/channels/:channelId/posts/:postId/comments/:commentId/like', LikePostComment);
	r.delete('/api/channels/:channelId/posts/:postId/comments/:commentId/like', UnlikePostComment);
	r.get('/api/channels/:channelId/posts/:postId/comments/:commentId/replies', ListPostCommentReplies);
	r.post('/api/channels/:channelId/posts/:postId/comments/:commentId/pin', PinPostComment);
	r.post('/api/channels/:channelId/posts/:postId/comments/:commentId/heart', HeartPostComment);
}

function env() {
	const channels: Record<string, unknown> = { [CH]: { id: CH, userId: OWNER, name: 'Channel' } };
	for (let i = 0; i < 60; i++) channels[`u${i}-ch`] = { id: `u${i}-ch`, userId: `u${i}`, name: `User ${i}` };
	return {
		community_posts: new SlowBucket({
			[POST_KEY]: {
				id: 'p1', channelId: CH, userId: OWNER, type: 'text', content: 'Post', status: 'published', visibility: 'public',
				commentsEnabled: true, likes: 0, comments: 0, views: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
			},
		}),
		channels: new MemoryBucket(channels),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	};
}

const as = (userId: string) => buildApp(routes, { userId });
const headers = (channelId: string) => ({ 'Content-Type': 'application/json', channelId });
const user = (i: number) => ({ app: as(`u${i}`), h: headers(`u${i}-ch`) });

async function comment(e: any, i: number, content: string, parentCommentId?: string): Promise<string> {
	const { app, h } = user(i);
	const res = await app.request(BASE, { method: 'POST', headers: h, body: JSON.stringify({ content, ...(parentCommentId ? { parentCommentId } : {}) }) }, e);
	assert.equal(res.status, 201, await res.clone().text());
	return ((await res.json()) as any).comment.id;
}

const list = async (e: any) => ((await (await as(OWNER).request(`${BASE}?limit=100`, { headers: headers(CH) }, e)).json()) as any).comments as any[];
const stored = (e: any, id: string) => e.community_posts.read(`comments/p1/top-level/${id}.json`);

describe('comment indexes (AV-10)', () => {
	it('40 people commenting at once are all listed', async () => {
		const e = env();
		const ids = await Promise.all(Array.from({ length: 40 }, (_, i) => comment(e, i, `Comment ${i}`)));
		const listed = await list(e);
		assert.deepEqual(listed.map((c) => c.id).sort(), [...ids].sort());
		assert.equal(e.community_posts.read(POST_KEY).comments, 40);
	});

	it('30 parallel replies are all in the thread and counted on the parent', async () => {
		const e = env();
		const parent = await comment(e, 0, 'Parent');
		const replies = await Promise.all(Array.from({ length: 30 }, (_, i) => comment(e, i + 1, `Reply ${i}`, parent)));
		const thread = ((await (await as(OWNER).request(`${BASE}/${parent}/replies?limit=100`, { headers: headers(CH) }, e)).json()) as any);
		const threadIds = (thread.replies ?? thread.comments ?? []).map((r: any) => r.id);
		assert.deepEqual([...threadIds].sort(), [...replies].sort());
		assert.equal(stored(e, parent).repliesCount, 30);
	});
});

describe('comment likes and fields (AV-11)', () => {
	it('likes, duplicate likes, a heart, an edit and replies at once all land exactly', async () => {
		const e = env();
		const id = await comment(e, 0, 'Original');
		await Promise.all([
			// 20 users like, each twice (two tabs)
			...Array.from({ length: 40 }, (_, k) => { const { app, h } = user(10 + (k % 20)); return app.request(`${BASE}/${id}/like`, { method: 'POST', headers: h }, e); }),
			as(OWNER).request(`${BASE}/${id}/heart`, { method: 'POST', headers: headers(CH) }, e),
			user(0).app.request(`${BASE}/${id}`, { method: 'PUT', headers: user(0).h, body: JSON.stringify({ content: 'Edited' }) }, e),
			...Array.from({ length: 5 }, (_, i) => comment(e, 40 + i, `Reply ${i}`, id)),
		]);
		const c = stored(e, id);
		assert.equal(c.likes, 20, 'one like per user');
		assert.equal(c.isHeartedByCreator, true);
		assert.equal(c.content, 'Edited');
		assert.equal(c.repliesCount, 5);
		assert.equal(e.queue.messages.filter((m: any) => m.type === MessageType.PostCommentLiked).length, 20, 'one like event per user');
	});

	it('parallel unlikes (twice each) and likes end at the exact total', async () => {
		const e = env();
		const id = await comment(e, 0, 'C');
		for (let i = 1; i <= 20; i++) await user(i).app.request(`${BASE}/${id}/like`, { method: 'POST', headers: user(i).h }, e);
		await Promise.all([
			...Array.from({ length: 20 }, (_, k) => { const { app, h } = user(1 + (k % 10)); return app.request(`${BASE}/${id}/like`, { method: 'DELETE', headers: h }, e); }),
			...Array.from({ length: 15 }, (_, k) => { const { app, h } = user(30 + k); return app.request(`${BASE}/${id}/like`, { method: 'POST', headers: h }, e); }),
		]);
		assert.equal(stored(e, id).likes, 20 - 10 + 15);
	});

	it('deleting a comment twice at once counts once; an edit after the delete is refused', async () => {
		const e = env();
		const a = await comment(e, 0, 'A');
		await comment(e, 1, 'B');
		const statuses = await Promise.all([1, 2].map(() => user(0).app.request(`${BASE}/${a}`, { method: 'DELETE', headers: user(0).h }, e).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200));
		assert.equal(e.community_posts.read(POST_KEY).comments, 1, 'decremented once');
		const edit = await user(0).app.request(`${BASE}/${a}`, { method: 'PUT', headers: user(0).h, body: JSON.stringify({ content: 'x' }) }, e);
		assert.equal(edit.status, 400);
	});

	it('a reply racing the delete of a reply-less comment keeps the thread listed', async () => {
		for (let round = 0; round < 5; round++) {
			const e = env();
			const parent = await comment(e, 0, 'Parent');
			await Promise.all([
				user(0).app.request(`${BASE}/${parent}`, { method: 'DELETE', headers: user(0).h }, e),
				comment(e, 1, 'Reply', parent).catch(() => null),
			]);
			const repliesCount = stored(e, parent).repliesCount || 0;
			const listed = (await list(e)).map((c) => c.id);
			if (repliesCount > 0) assert.ok(listed.includes(parent), 'a deleted comment with a reply stays listed');
			else assert.ok(!listed.includes(parent));
		}
	});
});

describe('pinned comment (AV-12)', () => {
	it('pinning two comments at once leaves exactly one pinned', async () => {
		for (let round = 0; round < 5; round++) {
			const e = env();
			const a = await comment(e, 0, 'A');
			const b = await comment(e, 1, 'B');
			const c = await comment(e, 2, 'C');
			await Promise.all([a, b, c].map((id) => as(OWNER).request(`${BASE}/${id}/pin`, { method: 'POST', headers: headers(CH) }, e)));
			const listed = await list(e);
			const pinned = listed.filter((x) => x.isPinned);
			assert.equal(pinned.length, 1);
			assert.equal(pinned[0].id, e.community_posts.read('comments/p1/pinned.json').commentId);
			assert.equal(listed[0].id, pinned[0].id, 'the pinned comment is first');
		}
	});
});

describe('reply lookup without listing (AV-16)', () => {
	const countLists = (e: any) => {
		const counter = { lists: 0 };
		const list = e.community_posts.list.bind(e.community_posts);
		// Listings of reply keys only (a like still recounts that comment's like records)
		e.community_posts.list = async (opts: any) => { if (String(opts?.prefix ?? '').startsWith('comments/p1/replies/')) counter.lists++; return list(opts); };
		return counter;
	};

	it('a reply is liked, edited and unliked through its parent pointer, never by listing', async () => {
		const e = env();
		const parent = await comment(e, 0, 'Parent');
		const reply = await comment(e, 1, 'Reply', parent);
		assert.deepEqual(e.community_posts.read(`comments/p1/reply-parents/${reply}.json`), { parentCommentId: parent });
		const counter = countLists(e);
		const { app, h } = user(2);
		assert.equal((await app.request(`${BASE}/${reply}/like`, { method: 'POST', headers: h }, e)).status, 200);
		assert.equal((await user(1).app.request(`${BASE}/${reply}`, { method: 'PUT', headers: user(1).h, body: JSON.stringify({ content: 'Edited' }) }, e)).status, 200);
		assert.equal((await app.request(`${BASE}/${reply}/like`, { method: 'DELETE', headers: h }, e)).status, 200);
		assert.equal(counter.lists, 0);
		assert.equal(e.community_posts.read(`comments/p1/replies/${parent}/${reply}.json`).content, 'Edited');
	});

	it('a reply from before the pointers is found past the first 1000 keys, and found directly after that', async () => {
		const e = env();
		const parent = await comment(e, 0, 'Parent');
		// 1500 older replies without pointers; the one we act on sorts last
		for (let i = 0; i < 1500; i++) {
			const id = `old-${String(i).padStart(4, '0')}`;
			e.community_posts.store.set(`comments/p1/replies/${parent}/${id}.json`, JSON.stringify({ id, postId: 'p1', parentCommentId: parent, userId: 'u9', content: id, likes: 0, createdAt: '2026-01-01T00:00:00.000Z' }));
		}
		const target = 'old-zzzz';
		e.community_posts.store.set(`comments/p1/replies/${parent}/${target}.json`, JSON.stringify({ id: target, postId: 'p1', parentCommentId: parent, userId: 'u9', content: 'Target', likes: 0, createdAt: '2026-01-01T00:00:00.000Z' }));
		const { app, h } = user(3);
		const first = await app.request(`${BASE}/${target}/like`, { method: 'POST', headers: h }, e);
		assert.equal(first.status, 200, 'the old lookup read one page and answered 404 here');
		assert.deepEqual(e.community_posts.read(`comments/p1/reply-parents/${target}.json`), { parentCommentId: parent }, 'the pointer is written on first lookup');
		const counter = countLists(e);
		assert.equal((await app.request(`${BASE}/${target}/like`, { method: 'DELETE', headers: h }, e)).status, 200);
		assert.equal(counter.lists, 0, 'found through the pointer');
	});
});

describe('a user without a channel comments as themselves', () => {
	it('no channelId header: the comment carries the profile\'s resolved name (first + last), never the email', async () => {
		const e = { ...env(), profiles: new MemoryBucket({ solo: { id: 'solo', email: 'solo@example.org', displayName: '', firstName: 'Mahmoud', lastName: 'Darwish' } }) };
		const res = await as('solo').request(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Salam' }) }, e);
		const text = await res.text();
		assert.equal(res.status, 201, text);
		const body = JSON.parse(text) as { comment: { userDisplayName: string; channelId: string } };
		assert.equal(body.comment.userDisplayName, 'Mahmoud Darwish');
		assert.equal(body.comment.channelId, 'solo');
		assert.ok(!text.includes('solo@example.org'));
	});
});
