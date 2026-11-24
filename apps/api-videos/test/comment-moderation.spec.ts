/** POST /internal/admin/comment-moderation: a reported comment is hidden, and only it. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import adminRouter from '../src/routers/admin.router';
import { moderatePostComment, moderateVideoComment } from '../src/lib/channelComments/moderation';
import { MemoryBucket, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function setup() {
	const env = {
		SEARCH_DB: new SqliteD1(),
		videos: new MemoryBucket({ v_1: videoFixture({ id: 'v_1', userId: 'usr_owner', channelId: 'ch_1', comments: [{ id: 'c_1', userId: 'usr_a', text: 'one', replies: [{ id: 'r_1', userId: 'usr_b', text: 'two' }] }, { id: 'c_2', userId: 'usr_c', text: 'three', status: 'held' }] } as never) }),
		community_posts: new MemoryBucket({
			'post-locations/p_1': { channelId: 'ch_1' },
			'posts/ch_1/p_1.json': { id: 'p_1', userId: 'usr_owner', channelId: 'ch_1', status: 'published', comments: 1 },
			'comments/p_1/top-level/pc_1.json': { id: 'pc_1', postId: 'p_1', userId: 'usr_a', content: 'four' },
		}),
	};
	const app = new Hono();
	app.route('/internal/admin', adminRouter as never);
	const hold = async (body: unknown) => {
		const res = await app.request('/internal/admin/comment-moderation', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Actor': 'usr_mod' }, body: JSON.stringify(body) }, env as never);
		return { status: res.status, result: ((await res.json()) as any).result };
	};
	return { env, hold };
}

describe('hiding a reported comment', () => {
	it('on a video: held by moderation, nothing else on the video changes, and the channel cannot release it', async () => {
		const { env, hold } = setup();
		assert.deepEqual(await hold({ on: 'video', parentId: 'v_1', commentId: 'c_1' }), { status: 200, result: { found: true, changed: true } });
		const [first, second] = env.videos.read('v_1').comments;
		assert.deepEqual([first.status, first.heldBy, first.moderation.userId], ['held', 'moderation', 'usr_mod']);
		assert.equal(first.replies[0].status, undefined);
		assert.equal(second.heldBy, undefined);
		assert.ok(!env.videos.read('v_1').isHidden);
		assert.deepEqual(await hold({ on: 'video', parentId: 'v_1', commentId: 'c_1' }), { status: 200, result: { found: true, changed: false } });
		assert.deepEqual(await moderateVideoComment({ env: env as never }, 'v_1', 'c_1', 'approve', 'usr_owner'), { ok: false, error: 'held_by_moderation' });
	});

	it('a reply, and a comment its channel already held (the hold becomes the platform\'s)', async () => {
		const { env, hold } = setup();
		await hold({ on: 'video', parentId: 'v_1', commentId: 'r_1' });
		assert.equal(env.videos.read('v_1').comments[0].replies[0].heldBy, 'moderation');
		assert.equal(env.videos.read('v_1').comments[0].status, undefined);
		assert.deepEqual((await hold({ on: 'video', parentId: 'v_1', commentId: 'c_2' })).result, { found: true, changed: true });
		assert.equal(env.videos.read('v_1').comments[1].heldBy, 'moderation');
	});

	it('on a post: held, off the post\'s count once, and the channel cannot release it', async () => {
		const { env, hold } = setup();
		assert.deepEqual((await hold({ on: 'post', parentId: 'p_1', commentId: 'pc_1' })).result, { found: true, changed: true });
		const stored = env.community_posts.read('comments/p_1/top-level/pc_1.json');
		assert.deepEqual([stored.status, stored.heldBy], ['held', 'moderation']);
		assert.equal(env.community_posts.read('posts/ch_1/p_1.json').comments, 0);
		assert.deepEqual((await hold({ on: 'post', parentId: 'p_1', commentId: 'pc_1' })).result, { found: true, changed: false });
		assert.equal(env.community_posts.read('posts/ch_1/p_1.json').comments, 0);
		assert.deepEqual(await moderatePostComment({ env: env as never }, 'ch_1', 'p_1', 'pc_1', 'approve', 'usr_owner'), { ok: false, error: 'held_by_moderation' });
	});

	it('a channel\'s own hold is unchanged: it can still release it', async () => {
		const { env } = setup();
		await moderateVideoComment({ env: env as never }, 'v_1', 'c_1', 'hold', 'usr_owner');
		assert.equal(env.videos.read('v_1').comments[0].heldBy, undefined);
		assert.deepEqual(await moderateVideoComment({ env: env as never }, 'v_1', 'c_1', 'approve', 'usr_owner'), { ok: true, changed: true });
	});

	it('not there: found false; bad ids refused', async () => {
		const { hold } = setup();
		for (const body of [{ on: 'video', parentId: 'v_1', commentId: 'nope' }, { on: 'video', parentId: 'v_9', commentId: 'c_1' }, { on: 'post', parentId: 'p_9', commentId: 'pc_1' }, { on: 'post', parentId: 'p_1', commentId: 'c_1' }]) assert.deepEqual((await hold(body)).result, { found: false, changed: false });
		assert.equal((await hold({ on: 'video', parentId: '../x', commentId: 'c_1' })).status, 400);
		assert.equal((await hold({ on: 'channel', parentId: 'ch_1', commentId: 'c_1' })).status, 400);
	});
});
