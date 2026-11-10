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
import { POST_VIEW_COUNTER_SHARDS, postViewCounterName, recordPostViewDirect } from '../src/lib/post-views';

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

/** Stand-in for the VIEW_COUNTER namespace's post counters: counts per object name. */
function fakePostCounter(opts: { fail?: boolean } = {}) {
	const totals = new Map<string, number>();
	const ns = {
		idFromName: (name: string) => name,
		get: (name: string) => ({
			async fetch(url: string, init: RequestInit) {
				if (opts.fail) return new Response('down', { status: 503 });
				assert.equal(new URL(url).pathname, '/post-views/increment');
				const body = JSON.parse(String(init.body));
				assert.equal(name, postViewCounterName(body.postId, body.shard));
				totals.set(name, (totals.get(name) ?? 0) + 1);
				return Response.json({ unflushed: totals.get(name) });
			},
		}),
	};
	return { ns: ns as unknown as DurableObjectNamespace, totals };
}

async function d1Views(db: D1Database): Promise<number> {
	const row = await db.prepare(`SELECT COALESCE(SUM(value), 0) AS n FROM analytics_daily WHERE entity_type = 'post' AND metric = 'views'`).first<{ n: number }>();
	return Number(row?.n ?? 0);
}

describe('community post views are batched by the view counter (AV-17)', () => {
	it('views go to the post counter shards, not one D1 write each; the viewer sees their view', async () => {
		const counter = fakePostCounter();
		const e = { ...env(), VIEW_COUNTER: counter.ns };
		const random = Math.random;
		let i = 0;
		Math.random = () => (i++ % POST_VIEW_COUNTER_SHARDS) / POST_VIEW_COUNTER_SHARDS;
		try {
			const views = await Promise.all(Array.from({ length: 40 }, () => anon.request(`/api/channels/${CH}/posts/p1`, {}, e).then((r) => r.json() as Promise<any>)));
			assert.equal(await d1Views(e.NOTIFICATIONS_DB), 0, 'no D1 write per view');
			assert.equal([...counter.totals.values()].reduce((a, b) => a + b, 0), 40);
			assert.equal(counter.totals.size, POST_VIEW_COUNTER_SHARDS, 'spread over every shard');
			assert.ok(views.every((v) => v.views > 5), 'legacy count + the unflushed views of the shard');
		} finally {
			Math.random = random;
		}
	});

	it('an unreachable counter falls back to one atomic D1 upsert per view', async () => {
		const e = { ...env(), VIEW_COUNTER: fakePostCounter({ fail: true }).ns };
		await Promise.all(Array.from({ length: 25 }, () => anon.request(`/api/channels/${CH}/posts/p1`, {}, e)));
		assert.equal(await d1Views(e.NOTIFICATIONS_DB), 25);
		const view = (await (await anon.request(`/api/channels/${CH}/posts/p1`, {}, e)).json()) as any;
		assert.equal(view.views, 5 + 26);
	});

	it('counter rows (dim counter:<shard>) and direct rows add up for readers', async () => {
		const e = env();
		const day = new Date().toISOString().slice(0, 10);
		await e.NOTIFICATIONS_DB.prepare(`INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value) VALUES ('post', 'p1', ?, 'views', 'counter:0', 7), ('post', 'p1', ?, 'views', 'counter:3', 4)`).bind(day, day).run();
		const listed = (await (await anon.request(`/api/channels/${CH}/posts`, {}, e)).json()) as any;
		assert.equal(listed.posts[0].views, 5 + 11);
		assert.equal(await recordPostViewDirect(e.NOTIFICATIONS_DB, 'p1'), true);
		const again = (await (await anon.request(`/api/channels/${CH}/posts`, {}, e)).json()) as any;
		assert.equal(again.posts[0].views, 5 + 12);
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
