/**
 * Channel roles in the areas that were owner only before CH-1
 * (docs/specs/CHANNEL-ROLES.md §6.3): community posts, post comment
 * moderation and live streams; and member data in the privacy footprints and
 * erasure (§12).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { GetCommunityPost } from '../src/endpoints/community/get-post';
import { ListCommunityPosts } from '../src/endpoints/community/list-posts';
import { DeletePostComment } from '../src/endpoints/community/post-comment-delete';
import { PinPostComment } from '../src/endpoints/community/post-comment-pin';
import { HeartPostComment } from '../src/endpoints/community/post-comment-heart';
import { LiveStreamUpdate } from '../src/endpoints/live/liveStreamUpdate';
import { LiveStreamGet } from '../src/endpoints/live/liveSession';
import { canManageLiveStream } from '../src/lib/channelAccess';
import { footprintsOf, videoUserIds } from '../src/lib/privacy/footprints';
import { eraseUserData, DELETED_USER_ID } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'team';
const member = (userId: string, role: string) => ({ userId, role, addedBy: 'owner', addedAt: '2026-11-01T00:00:00.000Z' });
const teamChannel = () => ({
	id: CH, name: 'Team', userId: 'owner', isMain: true,
	members: [member('adm', 'admin'), member('ed', 'editor'), member('mod', 'moderator')],
});

function post(overrides: Record<string, unknown> = {}) {
	return {
		id: 'p1', channelId: CH, userId: 'owner', type: 'text', content: 'Hello', status: 'published', visibility: 'public',
		commentsEnabled: true, likes: 0, comments: 1, views: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

function postsEnv(stored = post()) {
	return {
		community_posts: new MemoryBucket({
			[`posts/${CH}/p1.json`]: stored,
			[`posts/${CH}/index.json`]: { postIds: ['p1'], lastUpdated: '2026-01-01T00:00:00.000Z' },
			'comments/p1/top-level/c1.json': { id: 'c1', postId: 'p1', userId: 'viewer', content: 'Nice', createdAt: '2026-01-02T00:00:00.000Z' },
			'comments/p1/top-level/index.json': { postId: 'p1', commentIds: ['c1'], lastUpdated: '2026-01-02T00:00:00.000Z' },
		}),
		channels: new MemoryBucket({ [CH]: teamChannel() }),
		profiles: new MemoryBucket(),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	};
}

function postRoutes(r: any) {
	r.post('/api/community/channels/:channelId/posts', CreateCommunityPost);
	r.get('/api/community/channels/:channelId/posts', ListCommunityPosts);
	r.get('/api/community/channels/:channelId/posts/:postId', GetCommunityPost);
	r.post('/api/community/channels/:channelId/posts/:postId/comments/:commentId/pin', PinPostComment);
	r.post('/api/community/channels/:channelId/posts/:postId/comments/:commentId/heart', HeartPostComment);
	r.delete('/api/community/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);
}

/** An app whose caller acts as the channel with `role` (what channelIdMiddleware sets). */
function actingAs(userId: string, role: string | null) {
	return buildApp((r) => {
		r.use?.('*', async (c: any, next: any) => {
			if (role) c.set('channelRole', role);
			await next();
		});
		postRoutes(r);
	}, { userId, ...(role && role !== 'owner' ? { channelOwnerId: 'owner' } : {}) });
}

const jsonHeaders = { 'Content-Type': 'application/json', channelId: CH };

describe('community posts (post.manage)', () => {
	it('an editor posts as the channel: the post belongs to the owner and records the author; a moderator cannot post', async () => {
		const env = postsEnv();
		const res = await actingAs('ed', 'editor').request(`/api/community/channels/${CH}/posts`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ type: 'text', content: 'From the editor' }) }, env as never);
		assert.equal(res.status, 200, await res.clone().text());
		const { post: created } = (await res.json()) as { post: { id: string } };
		const stored = [env.community_posts.read(`posts/${CH}/${created.id}.json`)];
		assert.equal(stored.length, 1);
		assert.equal(stored[0].userId, 'owner');
		assert.equal(stored[0].authorId, 'ed');

		const refused = await actingAs('mod', 'moderator').request(`/api/community/channels/${CH}/posts`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ type: 'text', content: 'No' }) }, env as never);
		assert.equal(refused.status, 403);
		const stranger = await actingAs('stranger', null).request(`/api/community/channels/${CH}/posts`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ type: 'text', content: 'No' }) }, env as never);
		assert.equal(stranger.status, 403);
	});

	it('who wrote a post is shown to those who manage posts, never to visitors', async () => {
		const env = postsEnv(post({ authorId: 'ed' }));
		const visitor = (await (await buildApp(postRoutes).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).json()) as any;
		assert.equal(visitor.authorId, undefined);
		const listed = (await (await buildApp(postRoutes).request(`/api/community/channels/${CH}/posts`, {}, env as never)).json()) as any;
		assert.equal(listed.posts[0].authorId, undefined);
		const admin = (await (await buildApp(postRoutes, { userId: 'adm' }).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).json()) as any;
		assert.equal(admin.authorId, 'ed');
		const moderator = (await (await buildApp(postRoutes, { userId: 'mod' }).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).json()) as any;
		assert.equal(moderator.authorId, undefined, 'a channel moderator does not manage posts');
	});

	it('a scheduled post is visible to an editor of the channel, not to a moderator or visitor', async () => {
		const env = postsEnv(post({ scheduledAt: '2999-01-01T00:00:00.000Z', status: 'scheduled' }));
		assert.equal((await buildApp(postRoutes, { userId: 'ed' }).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).status, 200);
		assert.equal((await buildApp(postRoutes, { userId: 'mod' }).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).status, 404);
		assert.equal((await buildApp(postRoutes).request(`/api/community/channels/${CH}/posts/p1`, {}, env as never)).status, 404);
	});
});

describe('post comment moderation (comment.moderate)', () => {
	it('a channel moderator pins and hearts; an editor cannot', async () => {
		const env = postsEnv();
		const pin = (userId: string) => buildApp(postRoutes, { userId }).request(`/api/community/channels/${CH}/posts/p1/comments/c1/pin`, { method: 'POST', headers: jsonHeaders }, env as never);
		assert.equal((await pin('ed')).status, 403);
		assert.equal((await pin('mod')).status, 200);
		const heart = (userId: string) => buildApp(postRoutes, { userId }).request(`/api/community/channels/${CH}/posts/p1/comments/c1/heart`, { method: 'POST', headers: jsonHeaders }, env as never);
		assert.equal((await heart('ed')).status, 403);
		assert.equal((await heart('adm')).status, 200);
	});

	it('removing someone else\'s comment as the channel needs comment.moderate', async () => {
		const env = postsEnv();
		const remove = (userId: string, role: string) => actingAs(userId, role).request(`/api/community/channels/${CH}/posts/p1/comments/c1`, { method: 'DELETE', headers: jsonHeaders }, env as never);
		assert.equal((await remove('ed', 'editor')).status, 403);
		assert.equal((await remove('mod', 'moderator')).status, 200);
		// The channel's removal is soft (Studio Comments, #771): restorable for 90 days
		const removed = env.community_posts.read('comments/p1/top-level/c1.json');
		assert.equal(removed.isDeleted, true);
		assert.equal(removed.removedBy, 'channel');
		assert.equal(removed.removedByUserId, 'mod');
		assert.ok(removed.removedAt);
	});
});

describe('live streams (live.manage)', () => {
	const stream = { id: 's1', title: 'Live', userId: 'owner', channelId: CH, status: 'scheduled', isPrivate: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' };
	const liveEnv = () => ({ videos: new MemoryBucket({ 'livestream:s1': stream }), channels: new MemoryBucket({ [CH]: teamChannel() }), queue: new MemoryQueue() });

	it('canManageLiveStream: owner and channel admin yes; editor, moderator and strangers no', async () => {
		const env = liveEnv();
		for (const [userId, expected] of [['owner', true], ['adm', true], ['ed', false], ['mod', false], ['x', false]] as const) {
			assert.equal(await canManageLiveStream(env as never, stream, userId), expected, userId);
		}
		assert.equal(await canManageLiveStream(env as never, { userId: 'owner', channelId: null }, 'adm'), false, 'no channel: owner only');
		assert.equal(await canManageLiveStream({ channels: { get: async () => { throw new Error('down'); } } } as never, stream, 'adm'), false, 'fails closed');
	});

	it('a channel admin edits and sees the private stream; an editor gets 403 and 404; the owner never changes', async () => {
		const env = liveEnv();
		const routes = (r: any) => { r.patch('/api/live-streams/:id', LiveStreamUpdate); r.get('/api/live-streams/:id', LiveStreamGet); };
		const edit = (userId: string) => buildApp(routes, { userId }).request('/api/live-streams/s1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `By ${userId}` }) }, env as never);
		assert.equal((await edit('ed')).status, 403);
		assert.equal((await edit('adm')).status, 200);
		assert.equal(env.videos.read('livestream:s1').title, 'By adm');
		assert.equal(env.videos.read('livestream:s1').userId, 'owner');
		assert.equal((await buildApp(routes, { userId: 'adm' }).request('/api/live-streams/s1', {}, env as never)).status, 200);
		assert.equal((await buildApp(routes, { userId: 'ed' }).request('/api/live-streams/s1', {}, env as never)).status, 404);
	});
});

describe('member data in privacy footprints and erasure', () => {
	it('footprints name the uploader, the channel members, a post\'s author and a playlist\'s creator', () => {
		assert.deepEqual(videoUserIds({ userId: 'owner', uploadedBy: 'ed' }), ['ed']);
		assert.deepEqual(footprintsOf('channels', CH, teamChannel())[0].userIds, ['adm', 'ed', 'mod']);
		assert.deepEqual(footprintsOf('community_posts', `posts/${CH}/p1.json`, post({ authorId: 'ed' }))[0].userIds, ['ed', 'owner']);
		assert.deepEqual(footprintsOf('playlists', 'pl1', { userId: 'owner', createdBy: 'ed' })[0].userIds, ['ed', 'owner']);
	});

	it('erasing a member removes their role and anonymises what they made, which stays with the channel', async () => {
		const env = {
			profiles: new MemoryBucket({ ed: { id: 'ed' } }),
			channels: new MemoryBucket({ [CH]: teamChannel() }),
			channel_sections: new MemoryBucket(),
			channel_tabs: new MemoryBucket(),
			videos: new MemoryBucket({
				v1: { id: 'v1', userId: 'owner', channelId: CH, uploadedBy: 'ed', title: 'Kept' },
				'livestream:s1': { id: 's1', userId: 'owner', channelId: CH, createdBy: 'ed' },
			}),
			watch_history: new MemoryBucket(),
			community_posts: new MemoryBucket({ [`posts/${CH}/p1.json`]: post({ authorId: 'ed' }) }),
			playlists: new MemoryBucket({ pl1: { id: 'pl1', userId: 'owner', channelId: CH, createdBy: 'ed' } }),
			'upload-defaults': new MemoryBucket(),
			reports: new MemoryBucket(),
			subtitles: new MemoryBucket(),
			queue: new MemoryQueue(),
		};
		const summary = await eraseUserData(env as never, 'ed', new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		assert.deepEqual(env.channels.read(CH).members.map((m: any) => m.userId), ['adm', 'mod']);
		assert.equal(env.videos.read('v1').uploadedBy, DELETED_USER_ID);
		assert.equal(env.videos.read('v1').title, 'Kept');
		assert.equal(env.videos.read('livestream:s1').createdBy, DELETED_USER_ID);
		assert.equal(env.community_posts.read(`posts/${CH}/p1.json`).authorId, DELETED_USER_ID);
		assert.equal(env.community_posts.read(`posts/${CH}/p1.json`).content, 'Hello');
		assert.equal(env.playlists.read('pl1').createdBy, DELETED_USER_ID);
		assert.equal(env.profiles.read('ed'), null);
	});
});
