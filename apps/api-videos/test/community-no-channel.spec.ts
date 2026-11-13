/**
 * A signed-in user without an active channel sends no `channelId` header. Chanfana hands a
 * missing header to the schema as null, so a header declared only `optional()` refused those
 * requests with 400 "Expected string, received null" (#1139). Liking, unliking, comment likes,
 * poll votes and creating a post (the owner check uses the URL's channel) must all work without
 * it, and the events they queue carry no null actor channel.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LikeCommunityPost } from '../src/endpoints/community/like-post';
import { UnlikeCommunityPost } from '../src/endpoints/community/unlike-post';
import { VoteOnPoll } from '../src/endpoints/community/vote-poll';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { CreatePostComment } from '../src/endpoints/community/post-comment-create';
import { LikePostComment } from '../src/endpoints/community/post-comment-like';
import { UnlikePostComment } from '../src/endpoints/community/post-comment-unlike';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'ch';
const OWNER = 'owner';
const NOW = '2026-01-01T00:00:00.000Z';

function routes(r: any) {
	r.post('/api/channels/:channelId/posts', CreateCommunityPost);
	r.post('/api/channels/:channelId/posts/:postId/like', LikeCommunityPost);
	r.delete('/api/channels/:channelId/posts/:postId/like', UnlikeCommunityPost);
	r.post('/api/channels/:channelId/posts/:postId/vote', VoteOnPoll);
	r.post('/api/channels/:channelId/posts/:postId/comments', CreatePostComment);
	r.post('/api/channels/:channelId/posts/:postId/comments/:commentId/like', LikePostComment);
	r.delete('/api/channels/:channelId/posts/:postId/comments/:commentId/like', UnlikePostComment);
}

const base = { channelId: CH, userId: OWNER, status: 'published', visibility: 'public', commentsEnabled: true, likes: 0, comments: 0, views: 0, createdAt: NOW, updatedAt: NOW };

function env() {
	return {
		community_posts: new SlowBucket({
			[`posts/${CH}/p1.json`]: { ...base, id: 'p1', type: 'text', content: 'Post' },
			[`posts/${CH}/poll1.json`]: {
				...base,
				id: 'poll1',
				type: 'poll',
				content: 'Which?',
				poll: { question: 'Which?', multipleChoice: false, options: [{ id: 'a', text: 'A', votes: 0 }, { id: 'b', text: 'B', votes: 0 }] },
			},
		}),
		channels: new MemoryBucket({ [CH]: { id: CH, userId: OWNER, name: 'Channel' } }),
		profiles: new MemoryBucket({ solo: { id: 'solo', displayName: 'Solo' }, [OWNER]: { id: OWNER, displayName: 'Owner' } }),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	};
}

const as = (userId: string) => buildApp(routes, { userId });
const JSON_ONLY = { 'Content-Type': 'application/json' };
const noNull = (e: any) => assert.equal(JSON.stringify(e.queue.messages).includes(':null'), false, 'no null actor channel in the queued events');

describe('community actions without a channelId header (#1139)', () => {
	it('likes and unlikes a post', async () => {
		const e = env();
		const liked = await as('solo').request(`/api/channels/${CH}/posts/p1/like`, { method: 'POST' }, e);
		assert.equal(liked.status, 200, await liked.text());
		assert.ok(e.community_posts.read('likes/p1/solo.json'), 'like stored for the user');
		const unliked = await as('solo').request(`/api/channels/${CH}/posts/p1/like`, { method: 'DELETE' }, e);
		assert.equal(unliked.status, 200, await unliked.text());
		assert.equal(e.community_posts.read('likes/p1/solo.json'), null, 'like removed');
		noNull(e);
	});

	it('likes and unlikes a comment', async () => {
		const e = env();
		const created = await as('solo').request(`/api/channels/${CH}/posts/p1/comments`, { method: 'POST', headers: JSON_ONLY, body: JSON.stringify({ content: 'Salam' }) }, e);
		assert.equal(created.status, 201, await created.clone().text());
		const id = ((await created.json()) as { comment: { id: string } }).comment.id;
		const liked = await as('other').request(`/api/channels/${CH}/posts/p1/comments/${id}/like`, { method: 'POST' }, e);
		assert.ok(liked.status < 300, `like: ${liked.status} ${await liked.text()}`);
		const unliked = await as('other').request(`/api/channels/${CH}/posts/p1/comments/${id}/like`, { method: 'DELETE' }, e);
		assert.ok(unliked.status < 300, `unlike: ${unliked.status} ${await unliked.text()}`);
		noNull(e);
	});

	it('votes on a poll', async () => {
		const e = env();
		const voted = await as('solo').request(`/api/channels/${CH}/posts/poll1/vote`, { method: 'POST', headers: JSON_ONLY, body: JSON.stringify({ optionIds: ['a'] }) }, e);
		assert.ok(voted.status < 300, `vote: ${voted.status} ${await voted.text()}`);
		const again = await as('solo').request(`/api/channels/${CH}/posts/poll1/vote`, { method: 'POST', headers: JSON_ONLY, body: JSON.stringify({ optionIds: ['b'] }) }, e);
		assert.equal(again.status, 400, 'one vote per user still holds');
		noNull(e);
	});

	it('the channel owner creates a post; someone else is refused by the owner check, not the schema', async () => {
		const e = env();
		const body = JSON.stringify({ type: 'text', content: 'Hello', visibility: 'public', commentsEnabled: true });
		const created = await as(OWNER).request(`/api/channels/${CH}/posts`, { method: 'POST', headers: JSON_ONLY, body }, e);
		assert.ok(created.status < 300, `create: ${created.status} ${await created.text()}`);
		const refused = await as('solo').request(`/api/channels/${CH}/posts`, { method: 'POST', headers: JSON_ONLY, body }, e);
		assert.equal(refused.status, 403, await refused.text());
		noNull(e);
	});
});
