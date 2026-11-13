/**
 * #1151: a member without a channel comments on videos as themselves, like on
 * community posts since #1139/#1144. No channelId header means the comment's
 * channelId is null and its author is the member's profile (display-name
 * rule, avatar); with a channel active the comment is that channel's, as
 * before. Replies, likes/unlikes (the reactor falls back to the user id),
 * edit and delete of one's own comment, list isLiked, queue events (no null
 * actor channel), the moderation scan, export and erase all handle both kinds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentRepliesList } from '../src/endpoints/video/commentRepliesList';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { CommentLikeDelete } from '../src/endpoints/video/commentLikeDelete';
import { collectUserData, eraseUserData, DELETED_USER_ID } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { footprintsOf } from '../src/lib/privacy/footprints';
import { MessageType } from '../src/lib/queue';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const VIEWER = 'viewer';

function env() {
	return {
		videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'creator', channelId: 'creator-ch', comments: [] }) }),
		channels: new MemoryBucket({
			'creator-ch': { id: 'creator-ch', userId: 'creator', name: 'Creator' },
			'member-ch': { id: 'member-ch', userId: 'member', name: 'Member channel', avatarUrl: 'member-ch.png' },
		}),
		profiles: new MemoryBucket({
			[VIEWER]: { id: VIEWER, email: 'viewer@test.local', displayName: '', firstName: 'Amina', lastName: 'Yusuf', avatarUrl: 'viewer.png' },
			member: { id: 'member', email: 'member@test.local', displayName: 'Member' },
		}),
		queue: new MemoryQueue(),
	} as any;
}

function routes(r: any) {
	r.get('/api/videos/:id/comments', CommentList);
	r.get('/api/videos/:id/comments/:cid/replies', CommentRepliesList);
	r.post('/api/videos/:id/comments', CommentCreate);
	r.put('/api/videos/:id/comments/:cid', CommentUpdate);
	r.delete('/api/videos/:id/comments/:cid', CommentDelete);
	r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	r.delete('/api/videos/:id/comments/:cid/likes', CommentLikeDelete);
}

async function call(e: any, user: string | null, method: string, path: string, body?: unknown, channelId?: string) {
	const headers: Record<string, string> = {};
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	if (channelId) headers.channelId = channelId;
	const res = await buildApp(routes, user ? { userId: user } : null).request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, e);
	return { status: res.status, body: (await res.json()) as any };
}

const stored = (e: any) => e.videos.read('v1').comments as any[];

describe('video comments without a channel (#1151)', () => {
	it('comments as themselves: channelId null, author from the profile (first + last, avatar)', async () => {
		const e = env();
		const res = await call(e, VIEWER, 'POST', '/api/videos/v1/comments', { content: 'Jazakum Allahu khayran' });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const item = res.body.result.comment;
		assert.equal(item.channelId, null);
		assert.equal(item.userId, VIEWER);
		assert.deepEqual(item.author, { userId: VIEWER, channelId: null, displayName: 'Amina Yusuf', avatarUrl: 'viewer.png' });
		assert.equal(stored(e)[0].channelId, null);

		const event = e.queue.messages.find((m: any) => m.type === MessageType.CommentCreate);
		assert.equal(event.payload.userId, VIEWER);
		assert.equal('channelId' in event.payload, false, 'no null actor channel on the event');

		// Anyone sees it with that author
		const list = await call(e, null, 'GET', '/api/videos/v1/comments');
		assert.equal(list.body.result.comments[0].author.displayName, 'Amina Yusuf');
		assert.equal(list.body.result.comments[0].channelId, null);
	});

	it('with a channel active the comment is still the channel\'s', async () => {
		const e = env();
		const res = await call(e, 'member', 'POST', '/api/videos/v1/comments', { content: 'as my channel' }, 'member-ch');
		assert.equal(res.status, 200);
		assert.equal(res.body.result.comment.channelId, 'member-ch');
		assert.equal(res.body.result.comment.author.displayName, 'Member channel');
		const event = e.queue.messages.find((m: any) => m.type === MessageType.CommentCreate);
		assert.equal(event.payload.channelId, 'member-ch');
	});

	it('replies, then likes and unlikes a comment; isLiked follows for the viewer without a channel', async () => {
		const e = env();
		const parent = (await call(e, 'member', 'POST', '/api/videos/v1/comments', { content: 'top' }, 'member-ch')).body.result.comment;
		const reply = await call(e, VIEWER, 'POST', '/api/videos/v1/comments', { content: 'a reply', parentCommentId: parent.id });
		assert.equal(reply.status, 200);
		assert.equal(reply.body.result.comment.parentCommentId, parent.id);
		assert.equal(reply.body.result.comment.author.displayName, 'Amina Yusuf');
		const replies = await call(e, VIEWER, 'GET', `/api/videos/v1/comments/${parent.id}/replies`);
		assert.deepEqual(replies.body.result.replies.map((r: any) => [r.id, r.channelId]), [[reply.body.result.comment.id, null]]);

		const liked = await call(e, VIEWER, 'POST', `/api/videos/v1/comments/${parent.id}/likes`);
		assert.ok(liked.status < 300, JSON.stringify(liked.body));
		assert.deepEqual(stored(e)[0].likes.map((l: any) => [l.userId, l.channelId]), [[VIEWER, VIEWER]], 'the reactor is the member');
		let list = await call(e, VIEWER, 'GET', '/api/videos/v1/comments');
		assert.equal(list.body.result.comments[0].isLiked, true);
		assert.equal(list.body.result.comments[0].likesCount, 1);
		// Another identity of someone else doesn't see it as theirs
		list = await call(e, 'member', 'GET', '/api/videos/v1/comments', undefined, 'member-ch');
		assert.equal(list.body.result.comments[0].isLiked, false);

		// Liking again is a no-op
		await call(e, VIEWER, 'POST', `/api/videos/v1/comments/${parent.id}/likes`);
		assert.equal(stored(e)[0].likes.length, 1);

		const unliked = await call(e, VIEWER, 'DELETE', `/api/videos/v1/comments/${parent.id}/likes`);
		assert.ok(unliked.status < 300);
		list = await call(e, VIEWER, 'GET', '/api/videos/v1/comments');
		assert.equal(list.body.result.comments[0].isLiked, false);
		assert.equal(list.body.result.comments[0].likesCount, 0);
	});

	it('edits and deletes their own comment without a channel; others cannot', async () => {
		const e = env();
		const cid = (await call(e, VIEWER, 'POST', '/api/videos/v1/comments', { content: 'first' })).body.result.comment.id;

		assert.equal((await call(e, 'member', 'PUT', `/api/videos/v1/comments/${cid}`, { text: 'hijack' }, 'member-ch')).status, 403);
		const edited = await call(e, VIEWER, 'PUT', `/api/videos/v1/comments/${cid}`, { text: 'edited' });
		assert.equal(edited.status, 200, JSON.stringify(edited.body));
		assert.equal(stored(e)[0].text, 'edited');
		assert.equal(stored(e)[0].isEdited, true);
		const editEvent = e.queue.messages.find((m: any) => m.type === MessageType.CommentEdit);
		assert.equal('channelId' in editEvent.payload, false);

		assert.equal((await call(e, 'member', 'DELETE', `/api/videos/v1/comments/${cid}`, undefined, 'member-ch')).status, 403);
		const deleted = await call(e, VIEWER, 'DELETE', `/api/videos/v1/comments/${cid}`);
		assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
		assert.equal((await call(e, null, 'GET', '/api/videos/v1/comments')).body.result.total, 0);
	});

	it('the video owner can still delete a channel-less comment (moderation)', async () => {
		const e = env();
		const cid = (await call(e, VIEWER, 'POST', '/api/videos/v1/comments', { content: 'spam' })).body.result.comment.id;
		const res = await call(e, 'creator', 'DELETE', `/api/videos/v1/comments/${cid}`, undefined, 'creator-ch');
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.equal((await call(e, null, 'GET', '/api/videos/v1/comments')).body.result.total, 0);
	});

	it('the footprint, export and erase cover a channel-less comment and like', async () => {
		const e = env();
		const parent = (await call(e, 'member', 'POST', '/api/videos/v1/comments', { content: 'top' }, 'member-ch')).body.result.comment;
		const mine = (await call(e, VIEWER, 'POST', '/api/videos/v1/comments', { content: 'mine' })).body.result.comment;
		await call(e, VIEWER, 'POST', `/api/videos/v1/comments/${parent.id}/likes`);

		const [fp] = footprintsOf('videos', 'v1', e.videos.read('v1'));
		assert.ok(fp.userIds.includes(VIEWER), 'the video footprint names the member');

		const full = {
			...e,
			channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), watch_history: new MemoryBucket(), community_posts: new MemoryBucket(),
			playlists: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket(), subtitles: new MemoryBucket(),
		};
		const data = await collectUserData(full, VIEWER, new OperationBudget(10_000));
		assert.deepEqual(data.videoComments.map((c: any) => [c.id, c.channelId]), [[mine.id, null]]);
		assert.equal(data.commentReactions.length, 1);

		const summary = await eraseUserData(full, VIEWER, new OperationBudget(10_000));
		assert.equal(summary.complete, true);
		const comments = stored(e);
		const anonymised = comments.find((c: any) => c.id === mine.id);
		assert.equal(anonymised.userId, DELETED_USER_ID);
		assert.equal(anonymised.text, '');
		assert.deepEqual(comments.find((c: any) => c.id === parent.id).likes, [], 'the member\'s like is gone');
	});
});
