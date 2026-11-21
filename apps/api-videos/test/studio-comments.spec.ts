/**
 * Studio Comments (docs/specs/CREATOR-STUDIO.md §4.7, #771): the channel
 * comment index, the moderation routes, channel blocks, the rebuild and purge
 * jobs, erasure, and community post writes by members.
 *
 * Real endpoints over in-memory R2 and a real SQLite D1 (search migrations),
 * with every R2 write going through the search-sync wrapper as in production.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, STUDIO_COMMENTS_BULK_MAX } from '@al-ummah/shared-types';
import { withSearchSync } from '../src/lib/search/sync';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { CommentApprove } from '../src/endpoints/video/commentApprove';
import { CommentHeart, CommentHold, CommentPin, CommentRestore } from '../src/endpoints/video/commentModeration';
import { ChannelCommentsBulk, ChannelCommentsList, ChannelCommentsSummary } from '../src/endpoints/channel/channelComments';
import { ChannelBlockAdd, ChannelBlockRemove, ChannelBlocksList } from '../src/endpoints/channel/channelBlocks';
import { CreatePostComment } from '../src/endpoints/community/post-comment-create';
import { DeletePostComment } from '../src/endpoints/community/post-comment-delete';
import { ListPostComments } from '../src/endpoints/community/post-comments-list';
import { ListPostCommentReplies } from '../src/endpoints/community/post-comment-replies-list';
import { ApprovePostComment, HoldPostComment, RestorePostComment } from '../src/endpoints/community/post-comment-moderation';
import { CreateCommunityPost } from '../src/endpoints/community/create-post';
import { UpdateCommunityPost } from '../src/endpoints/community/update-post';
import { DeleteCommunityPost } from '../src/endpoints/community/delete-post';
import { RestoreCommunityPost } from '../src/endpoints/community/restore-post';
import { publicCommentsCount } from '../src/lib/comments';
import { memberMayActAs } from '../src/lib/channelAccess';
import { CHANNEL_COMMENTS_KIND, handleChannelCommentsBatch, rebuildNeedsActionKey, runPurgeStep, startCommentPurge } from '../src/lib/channelComments/jobs';
import { createChannelCommentsInternalRouter } from '../src/endpoints/channel/channelCommentsInternal';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const CH = 'ch';
const OWNER = 'owner';
const DAY = 24 * 60 * 60 * 1000;
const realFetch = globalThis.fetch;

function member(userId: string, role: string) {
	return { userId, role, addedBy: OWNER, addedAt: '2026-11-01T00:00:00.000Z' };
}

class RecordingQueue {
	sent: any[] = [];
	fail = false;
	async send(message: unknown) {
		if (this.fail) throw new Error('queue down');
		this.sent.push(message);
	}
}

function post(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, channelId: CH, userId: OWNER, type: 'text', content: `Post ${id}`, status: 'published', visibility: 'public',
		commentsEnabled: true, likes: 0, comments: 0, views: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
		...overrides,
	};
}

function routes(r: any) {
	r.get('/api/videos/:id/comments', CommentList);
	r.post('/api/videos/:id/comments', CommentCreate);
	r.delete('/api/videos/:id/comments/:cid', CommentDelete);
	r.post('/api/videos/:id/comments/:cid/approve', CommentApprove);
	r.post('/api/videos/:id/comments/:cid/restore', CommentRestore);
	r.post('/api/videos/:id/comments/:cid/hold', CommentHold);
	r.post('/api/videos/:id/comments/:cid/pin', CommentPin);
	r.post('/api/videos/:id/comments/:cid/heart', CommentHeart);
	r.get('/api/channels/:id/comments/summary', ChannelCommentsSummary);
	r.get('/api/channels/:id/comments', ChannelCommentsList);
	r.post('/api/channels/:id/comments/bulk', ChannelCommentsBulk);
	r.get('/api/channels/:id/blocks', ChannelBlocksList);
	r.post('/api/channels/:id/blocks', ChannelBlockAdd);
	r.delete('/api/channels/:id/blocks/:userId', ChannelBlockRemove);
	r.post('/api/community/channels/:channelId/posts', CreateCommunityPost);
	r.put('/api/community/channels/:channelId/posts/:postId', UpdateCommunityPost);
	r.delete('/api/community/channels/:channelId/posts/:postId', DeleteCommunityPost);
	r.post('/api/community/channels/:channelId/posts/:postId/restore', RestoreCommunityPost);
	r.get('/api/community/channels/:channelId/posts/:postId/comments', ListPostComments);
	r.post('/api/community/channels/:channelId/posts/:postId/comments', CreatePostComment);
	r.delete('/api/community/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);
	r.get('/api/community/channels/:channelId/posts/:postId/comments/:commentId/replies', ListPostCommentReplies);
	r.post('/api/community/channels/:channelId/posts/:postId/comments/:commentId/approve', ApprovePostComment);
	r.post('/api/community/channels/:channelId/posts/:postId/comments/:commentId/hold', HoldPostComment);
	r.post('/api/community/channels/:channelId/posts/:postId/comments/:commentId/restore', RestorePostComment);
}

async function setup(videoComments: unknown[] = []) {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
	const raw = {
		SEARCH_DB: db,
		NOTIFICATIONS_DB: createSqliteD1(),
		videos: new MemoryBucket(),
		channels: new MemoryBucket({
			[CH]: { id: CH, userId: OWNER, name: 'Channel', members: [member('ali', 'admin'), member('sara', 'editor'), member('mod', 'moderator')] },
			'u1-ch': { id: 'u1-ch', userId: 'u1', name: 'User One' },
			'troll-ch': { id: 'troll-ch', userId: 'troll', name: 'Troll' },
		}),
		profiles: new MemoryBucket({ u1: { id: 'u1', displayName: 'User One' }, troll: { id: 'troll', displayName: 'Troll' }, mod: { id: 'mod', displayName: 'Mod' } }),
		community_posts: new MemoryBucket({ [`posts/${CH}/p1.json`]: post('p1'), [`posts/${CH}/index.json`]: { postIds: ['p1'], lastUpdated: '2026-11-01T00:00:00.000Z' } }),
		playlists: new MemoryBucket(),
		queue: new MemoryQueue(),
		PROCESSING_CHECK_QUEUE: new RecordingQueue(),
		ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors',
		INTERNAL_API_KEY: 'k',
	};
	const env = withSearchSync(raw, ctx) as typeof raw;
	const flush = () => Promise.all(pending.splice(0));
	// Written through the sync wrapper, as an upload would be: ownership and comment rows exist
	await env.videos.put('v1', JSON.stringify(videoFixture({ id: 'v1', userId: OWNER, channelId: CH, title: 'Tafsir', comments: videoComments })));
	await flush();
	const call = async (userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
		const res = await buildApp(routes, userId ? { userId } : null).request(
			path,
			{ method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
			env as never,
		);
		await flush();
		return res;
	};
	/** Runs queued channel-comments messages until none is left (each consumer step may queue the next). */
	const drain = async () => {
		const q = raw.PROCESSING_CHECK_QUEUE;
		while (q.sent.length) {
			const body = q.sent.shift();
			const msg = { body, attempts: 1, ack() {}, retry() { throw new Error('unexpected retry'); } };
			await handleChannelCommentsBatch({ messages: [msg] }, env as never, ctx);
			await flush();
		}
	};
	/** First list call queues the rebuild; drain it so the index is ready. */
	const ready = async () => {
		await call(OWNER, 'GET', `/api/channels/${CH}/comments`);
		await drain();
	};
	const video = () => raw.videos.read('v1');
	const rows = (where = '1=1', ...params: unknown[]) => db.db.prepare(`SELECT * FROM channel_comments WHERE ${where} ORDER BY comment_id`).all(...(params as any[])) as any[];
	return { db, raw, env, ctx, flush, call, drain, ready, video, rows };
}

const json = async (res: Response) => (await res.json()) as any;

let reports: any[] = [];
beforeEach(() => {
	reports = [];
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		reports.push(JSON.parse(String(init?.body)));
		return new Response(null, { status: 202 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('channel comment index', () => {
	it('is written on every video write, in the same request: published, held, removed; channel-block holds kept out of Held', async () => {
		const s = await setup([
			commentFixture('c1', { userId: 'u1', channelId: 'u1-ch', text: 'see https://example.com' }),
			commentFixture('c2', { userId: 'u1', channelId: 'u1-ch', status: 'held', heldBy: 'moderation' }),
			commentFixture('c3', { userId: 'troll', channelId: 'troll-ch', status: 'held', heldBy: 'channel_block' }),
		]);
		const byId = Object.fromEntries(s.rows().map((r) => [r.comment_id, r]));
		assert.equal(byId.c1.status, 'published');
		assert.equal(byId.c1.has_link, 1);
		assert.equal(byId.c1.channel_id, CH);
		assert.equal(byId.c2.status, 'held');
		assert.equal(byId.c2.held_by, 'moderation');
		assert.equal(byId.c3.held_by, 'channel_block');

		await s.ready();
		const held = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=held`));
		assert.deepEqual(held.items.map((c: any) => c.id), ['c2'], 'a channel-block hold is never in Held');
		assert.equal(held.items[0].heldBy, 'moderation');
	});

	it('first list or summary queues a per-channel rebuild (indexing: true), the consumer builds it from content_ownership', async () => {
		const s = await setup([commentFixture('c1', { userId: 'u1', channelId: 'u1-ch', text: 'Jazak Allah khair' })]);
		// Rows written before this PR: the record exists, the index does not
		s.db.db.exec('DELETE FROM channel_comments; DELETE FROM channel_comment_sigs;');
		const first = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments/summary`));
		assert.equal(first.indexing, true);
		assert.equal(s.raw.PROCESSING_CHECK_QUEUE.sent.length, 1);
		assert.deepEqual(s.raw.PROCESSING_CHECK_QUEUE.sent[0], { kind: CHANNEL_COMMENTS_KIND, job: 'rebuild', channelId: CH, phase: 'videos' });
		// A second request while it runs does not queue another
		assert.equal((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments`))).indexing, true);
		assert.equal(s.raw.PROCESSING_CHECK_QUEUE.sent.length, 1);

		await s.drain();
		const state = s.db.db.prepare('SELECT status FROM channel_comments_index_state WHERE channel_id = ?').get(CH) as any;
		assert.equal(state.status, 'ready');
		const list = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments`));
		assert.ok(!list.indexing);
		assert.equal(list.total, 1);
		const [item] = list.items;
		assert.equal(item.id, 'c1');
		assert.equal(item.kind, 'video');
		assert.equal(item.targetId, 'v1');
		assert.equal(item.targetTitle, 'Tafsir');
		assert.equal(item.targetUrlPath, '/video/v1');
		assert.equal(item.text, 'Jazak Allah khair', 'text read from R2');
		assert.equal(item.author.displayName, 'User One');
		assert.equal(item.status, 'published');
	});

	it('flags the rebuild for an admin when the queue cannot take it, and when the last delivery fails', async () => {
		const s = await setup();
		s.raw.PROCESSING_CHECK_QUEUE.fail = true;
		const res = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments`));
		assert.ok(!res.indexing, 'not indexing: the rebuild failed to queue');
		await s.flush();
		const action = reports.flatMap((r) => r.events ?? []).find((e: any) => e.action)?.action;
		assert.equal(action.key, rebuildNeedsActionKey(CH));
		assert.deepEqual(action.retry, { kind: 'service', service: 'api-videos', path: '/internal/channel-comments/retry', body: { job: 'rebuild', channelId: CH } });

		// Admin Retry queues it again
		s.raw.PROCESSING_CHECK_QUEUE.fail = false;
		const retry = await createChannelCommentsInternalRouter().request('/retry', { method: 'POST', body: JSON.stringify({ job: 'rebuild', channelId: CH }) }, s.env as never);
		assert.equal(retry.status, 200);
		assert.equal(s.raw.PROCESSING_CHECK_QUEUE.sent[0].flagged, true);

		// The last delivery of a failing step flags it and the message goes on to the DLQ
		reports.length = 0;
		const broken = { ...s.env, SEARCH_DB: { prepare() { throw new Error('d1 down'); }, batch() { throw new Error('d1 down'); } } };
		let retried: unknown;
		await handleChannelCommentsBatch({ messages: [{ body: s.raw.PROCESSING_CHECK_QUEUE.sent[0], attempts: 6, ack() {}, retry(o: unknown) { retried = o; } }] }, broken as never, s.ctx);
		await s.flush();
		assert.ok(retried, 'retried (the queue moves it to the DLQ after max_retries)');
		assert.ok(reports.flatMap((r) => r.events ?? []).some((e: any) => e.action?.key === rebuildNeedsActionKey(CH)));
	});
});

describe('GET /api/channels/:id/comments: filters, search, pages, summary', () => {
	it('filters by text, target, no channel reply and links; pages with a cursor; summary counts each tab', async () => {
		const at = (m: number) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();
		const s = await setup([
			commentFixture('a', { userId: 'u1', channelId: 'u1-ch', text: 'Barak Allah feek', dateCreated: at(1) }),
			commentFixture('b', { userId: 'u1', channelId: 'u1-ch', text: 'link www.spam.com', dateCreated: at(2) }),
			commentFixture('c', { userId: 'u1', channelId: 'u1-ch', text: 'answered', dateCreated: at(3), replies: [commentFixture('cr', { userId: OWNER, channelId: CH, text: 'reply from the channel', dateCreated: at(4) })] }),
			commentFixture('h', { userId: 'u1', channelId: 'u1-ch', text: 'held one', status: 'held', dateCreated: at(5) }),
		]);
		await s.ready();
		const ids = async (query: string) => (await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments${query}`))).items.map((c: any) => c.id);
		assert.deepEqual(await ids(''), ['cr', 'c', 'b', 'a'], 'inbox, newest first');
		assert.deepEqual(await ids('?q=barak'), ['a']);
		assert.deepEqual(await ids('?q=user%20one'), ['c', 'b', 'a'], 'matches the author name too');
		assert.deepEqual(await ids('?hasLink=1'), ['b']);
		assert.deepEqual(await ids('?noReply=1'), ['b', 'a'], 'top-level, not by the channel, without a channel reply');
		assert.deepEqual(await ids('?target=video:v1&tab=held'), ['h']);
		assert.deepEqual(await ids('?target=post:p1'), []);
		assert.equal((await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?limit=500`)).status, 200, 'a larger limit is capped at 50');
		assert.equal((await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?target=nope`)).status, 400);

		const page1 = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?limit=3`));
		assert.deepEqual(page1.items.map((c: any) => c.id), ['cr', 'c', 'b']);
		assert.equal(page1.total, 4);
		assert.ok(page1.nextCursor);
		const page2 = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`));
		assert.deepEqual(page2.items.map((c: any) => c.id), ['a']);
		assert.equal(page2.nextCursor, null);
		const c = page1.items.find((i: any) => i.id === 'c');
		assert.equal(c.hasChannelReply, true);
		assert.equal(c.repliesCount, 1);

		const summary = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments/summary`));
		assert.deepEqual([summary.inbox, summary.held, summary.removed], [4, 1, 0]);
		assert.deepEqual(summary.recent.map((i: any) => i.id), ['cr', 'c', 'b', 'a']);
	});
});

describe('Studio comment routes: capabilities', () => {
	it('owner, admin and moderator read and moderate; editor and strangers are refused', async () => {
		const s = await setup([commentFixture('c1', { userId: 'u1', channelId: 'u1-ch' })]);
		await s.ready();
		for (const userId of [OWNER, 'ali', 'mod']) {
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/comments`)).status, 200, userId);
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/comments/summary`)).status, 200, userId);
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/blocks`)).status, 200, userId);
		}
		for (const userId of ['sara', 'u1']) {
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/comments`)).status, 403, userId);
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/comments/summary`)).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'hold', items: [{ kind: 'video', targetId: 'v1', commentId: 'c1' }] })).status, 403, userId);
			assert.equal((await s.call(userId, 'GET', `/api/channels/${CH}/blocks`)).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', `/api/channels/${CH}/blocks`, { userId: 'troll' })).status, 403, userId);
			assert.equal((await s.call(userId, 'DELETE', `/api/channels/${CH}/blocks/troll`)).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', '/api/videos/v1/comments/c1/hold')).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', '/api/videos/v1/comments/c1/restore')).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', '/api/videos/v1/comments/c1/pin', { pinned: true })).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', '/api/videos/v1/comments/c1/heart', { hearted: true })).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', `/api/community/channels/${CH}/posts/p1/comments/x/approve`)).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', `/api/community/channels/${CH}/posts/p1/comments/x/hold`)).status, 403, userId);
			assert.equal((await s.call(userId, 'POST', `/api/community/channels/${CH}/posts/p1/comments/x/restore`)).status, 403, userId);
		}
		assert.equal((await s.call(null, 'GET', `/api/channels/${CH}/comments`)).status, 401);
	});

	it('members acting as the channel pass the channelId middleware only with comment.moderate / post.manage', () => {
		for (const [role, ok] of [['admin', true], ['moderator', true], ['editor', false]] as const) {
			assert.equal(memberMayActAs(role, 'POST', `/api/channels/${CH}/comments/bulk`), ok, role);
			assert.equal(memberMayActAs(role, 'POST', `/api/channels/${CH}/blocks`), ok, role);
			assert.equal(memberMayActAs(role, 'DELETE', `/api/channels/${CH}/blocks/troll`), ok, role);
			assert.equal(memberMayActAs(role, 'POST', '/api/videos/v1/comments/c1/restore'), ok, role);
			assert.equal(memberMayActAs(role, 'POST', `/api/community/channels/${CH}/posts/p1/comments/c1/hold`), ok, role);
		}
		for (const [role, ok] of [['admin', true], ['editor', true], ['moderator', false]] as const) {
			assert.equal(memberMayActAs(role, 'POST', `/api/community/channels/${CH}/posts`), ok, role);
			assert.equal(memberMayActAs(role, 'PUT', `/api/community/channels/${CH}/posts/p1`), ok, role);
			assert.equal(memberMayActAs(role, 'DELETE', `/api/community/channels/${CH}/posts/p1`), ok, role);
			assert.equal(memberMayActAs(role, 'POST', '/api/community/media/upload/images'), ok, role);
		}
	});
});

describe('video comments: soft removal, restore, hold, pin, heart', () => {
	it("a moderator's DELETE is the channel's soft removal (replies stay with it); restore brings it back with commentsCount", async () => {
		const reply = commentFixture('r1', { userId: 'u1', channelId: 'u1-ch' });
		const s = await setup([commentFixture('c1', { userId: 'u1', channelId: 'u1-ch', replies: [reply] }), commentFixture('c2', { userId: 'u1', channelId: 'u1-ch' })]);
		await s.ready();
		assert.equal(publicCommentsCount(s.video().comments), 2);

		const del = await s.call('mod', 'DELETE', '/api/videos/v1/comments/c1');
		assert.equal(del.status, 200);
		assert.equal((await json(del)).removed, true);
		const c1 = s.video().comments.find((c: any) => c.id === 'c1');
		assert.equal(c1.isDeleted, true);
		assert.equal(c1.removedBy, 'channel');
		assert.equal(c1.removedByUserId, 'mod');
		assert.ok(c1.removedAt);
		assert.equal(c1.replies.length, 1, 'its replies stay with it');
		assert.equal(publicCommentsCount(s.video().comments), 1, 'commentsCount drops');
		const viewers = await json(await s.call('u1', 'GET', '/api/videos/v1/comments'));
		assert.deepEqual(viewers.result.comments.map((c: any) => c.id), ['c2'], 'gone for everyone, its author included');

		const removed = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=removed`));
		assert.deepEqual(removed.items.map((c: any) => c.id), ['c1']);
		assert.equal(removed.items[0].removedBy.userId, 'mod');
		assert.equal(removed.items[0].removedBy.displayName, 'Mod');
		const inbox = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments`));
		assert.deepEqual(inbox.items.map((c: any) => c.id), ['c2'], 'its reply leaves the inbox with it');

		assert.equal((await s.call(OWNER, 'POST', '/api/videos/v1/comments/c1/restore')).status, 200);
		const back = s.video().comments.find((c: any) => c.id === 'c1');
		assert.ok(!back.isDeleted && !back.removedBy);
		assert.equal(publicCommentsCount(s.video().comments), 2, 'commentsCount restored');
		assert.equal((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=removed`))).items.length, 0);
		// Restoring what is not removed
		assert.equal((await json(await s.call(OWNER, 'POST', '/api/videos/v1/comments/c2/restore'))).error, 'not_removed');
	});

	it("the author's own DELETE stays a hard delete; a restore after 90 days is refused", async () => {
		const old = new Date(Date.now() - 91 * DAY).toISOString();
		const s = await setup([
			commentFixture('c1', { userId: 'u1', channelId: 'u1-ch' }),
			commentFixture('c2', { userId: 'u1', channelId: 'u1-ch', isDeleted: true, removedBy: 'channel', removedAt: old, removedByUserId: OWNER }),
		]);
		await s.ready();
		assert.equal((await s.call('u1', 'DELETE', '/api/videos/v1/comments/c1')).status, 200);
		const c1 = s.video().comments.find((c: any) => c.id === 'c1');
		assert.ok(!c1 || (c1.isDeleted && c1.removedBy === undefined), 'hard delete, never in Removed');
		assert.equal(s.rows("comment_id = 'c1'").length, 0);
		const res = await s.call(OWNER, 'POST', '/api/videos/v1/comments/c2/restore');
		assert.equal(res.status, 409);
		assert.equal((await json(res)).error, 'restore_expired');
	});

	it('platform moderation holds and removals are never in Removed and cannot be restored or approved', async () => {
		const s = await setup([
			commentFixture('c1', { userId: 'u1', channelId: 'u1-ch', status: 'held', heldBy: 'moderation' }),
			commentFixture('c2', { userId: 'u1', channelId: 'u1-ch', isHidden: true }),
		]);
		await s.ready();
		const approve = await s.call(OWNER, 'POST', '/api/videos/v1/comments/c1/approve');
		assert.equal(approve.status, 403);
		assert.equal((await json(approve)).error, 'held_by_moderation');
		const bulk = await json(await s.call(OWNER, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'approve', items: [{ kind: 'video', targetId: 'v1', commentId: 'c1' }] }));
		assert.deepEqual(bulk.results, [{ commentId: 'c1', ok: false, error: 'held_by_moderation' }]);
		const restore = await s.call(OWNER, 'POST', '/api/videos/v1/comments/c2/restore');
		assert.equal(restore.status, 409);
		assert.equal((await json(restore)).error, 'not_removed', 'a platform removal is not the channel\'s to undo');
		assert.equal((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=removed`))).items.length, 0);
	});

	it('hold, approve, pin (one per video), heart', async () => {
		const s = await setup([
			commentFixture('c1', { userId: 'u1', channelId: 'u1-ch', isPinned: true }),
			commentFixture('c2', { userId: 'u1', channelId: 'u1-ch', replies: [commentFixture('r1', { userId: 'u1' })] }),
		]);
		await s.ready();
		assert.equal((await s.call('mod', 'POST', '/api/videos/v1/comments/c2/pin', { pinned: true })).status, 200);
		const pinned = s.video().comments.filter((c: any) => c.isPinned).map((c: any) => c.id);
		assert.deepEqual(pinned, ['c2'], 'pinning replaces the current pin');
		assert.equal((await s.call('mod', 'POST', '/api/videos/v1/comments/r1/pin', { pinned: true })).status, 400, 'a reply cannot be pinned');
		assert.equal((await s.call('mod', 'POST', '/api/videos/v1/comments/c1/heart', { hearted: true })).status, 200);
		assert.equal(s.video().comments.find((c: any) => c.id === 'c1').isHearted, true);

		assert.equal((await s.call('mod', 'POST', '/api/videos/v1/comments/c2/hold')).status, 200);
		const held = s.video().comments.find((c: any) => c.id === 'c2');
		assert.equal(held.status, 'held');
		assert.ok(!held.isPinned, 'a held comment is unpinned');
		assert.deepEqual((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=held`))).items.map((c: any) => c.id), ['c2']);
		assert.equal((await s.call('mod', 'POST', '/api/videos/v1/comments/c2/approve')).status, 200);
		assert.equal(s.video().comments.find((c: any) => c.id === 'c2').status, 'published');
	});
});

describe('POST /api/channels/:id/comments/bulk', () => {
	it('takes 1 to 50 items, answers per item, and refuses comments of other channels', async () => {
		const s = await setup([commentFixture('c1', { userId: 'u1', channelId: 'u1-ch' }), commentFixture('c2', { userId: 'u1', channelId: 'u1-ch' })]);
		await s.env.videos.put('other', JSON.stringify(videoFixture({ id: 'other', userId: 'x', channelId: 'xch', comments: [commentFixture('o1')] })));
		await s.ready();
		const item = (commentId: string, targetId = 'v1') => ({ kind: 'video', targetId, commentId });
		assert.equal((await s.call(OWNER, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'remove', items: [] })).status, 400);
		const tooMany = Array.from({ length: STUDIO_COMMENTS_BULK_MAX + 1 }, (_, i) => item(`c${i}`));
		assert.equal((await s.call(OWNER, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'remove', items: tooMany })).status, 400);
		assert.equal((await s.call(OWNER, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'explode', items: [item('c1')] })).status, 400);

		const res = await json(await s.call('mod', 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'remove', items: [item('c1'), item('c2'), item('o1', 'other'), item('missing')] }));
		assert.deepEqual(res.results, [
			{ commentId: 'c1', ok: true },
			{ commentId: 'c2', ok: true },
			{ commentId: 'o1', ok: false, error: 'not_in_channel' },
			{ commentId: 'missing', ok: false, error: 'not_found' },
		]);
		assert.equal(s.video().comments.every((c: any) => c.removedBy === 'channel'), true);
		assert.equal(s.raw.videos.read('other').comments[0].removedBy, undefined, 'another channel is untouched');
		const restored = await json(await s.call('mod', 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'restore', items: [item('c1'), item('c2')] }));
		assert.ok(restored.results.every((r: any) => r.ok));
		assert.equal(publicCommentsCount(s.video().comments), 2);
		// Every action is audited on the comment
		assert.deepEqual({ ...s.video().comments[0].moderation, at: undefined }, { action: 'restore', userId: 'mod', at: undefined });
	});
});

describe('channel blocks', () => {
	it('blocks silently: new comments are held with heldBy channel_block, seen only by their author, never in Held', async () => {
		const s = await setup();
		await s.ready();
		assert.equal((await s.call('mod', 'POST', `/api/channels/${CH}/blocks`, { userId: 'troll' })).status, 200);
		assert.equal((await s.call('mod', 'POST', `/api/channels/${CH}/blocks`, { userId: 'troll' })).status, 200, 'idempotent');
		for (const userId of [OWNER, 'ali', 'sara', 'mod']) {
			const res = await s.call(OWNER, 'POST', `/api/channels/${CH}/blocks`, { userId });
			assert.equal(res.status, 400, userId);
			assert.equal((await json(res)).error, 'cannot_block_member');
		}
		assert.equal((await s.call(OWNER, 'POST', `/api/channels/${CH}/blocks`, { userId: 'nobody' })).status, 404);
		const blocks = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/blocks`));
		assert.deepEqual(blocks.items.map((b: any) => [b.userId, b.displayName]), [['troll', 'Troll']]);

		const created = await s.call('troll', 'POST', '/api/videos/v1/comments', { text: 'hello' }, { channelId: 'troll-ch' });
		assert.equal(created.status, 200, await created.clone().text());
		const stored = s.video().comments[0];
		assert.equal(stored.status, 'held');
		assert.equal(stored.heldBy, 'channel_block');
		const asTroll = await json(await s.call('troll', 'GET', '/api/videos/v1/comments', undefined, { channelId: 'troll-ch' }));
		assert.equal(asTroll.result.comments.length, 1, 'its author sees it');
		assert.equal(asTroll.result.comments[0].isHeld, false, 'and is not told it is held');
		const asOther = await json(await s.call('u1', 'GET', '/api/videos/v1/comments'));
		assert.equal(asOther.result.comments.length, 0);
		assert.equal(publicCommentsCount(s.video().comments), 0);
		assert.equal((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=held`))).items.length, 0);
		assert.equal((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments/summary`))).held, 0);

		// Blocked on posts too
		const postComment = await s.call('troll', 'POST', `/api/community/channels/${CH}/posts/p1/comments`, { content: 'hi' }, { channelId: 'troll-ch' });
		assert.equal(postComment.status, 201, await postComment.clone().text());
		assert.equal(s.raw.community_posts.read(`posts/${CH}/p1.json`).comments, 0, 'not counted');
		const postList = (userId: string) => s.call(userId, 'GET', `/api/community/channels/${CH}/posts/p1/comments`);
		assert.equal((await json(await postList('troll'))).comments.length, 1);
		assert.equal((await json(await postList('u1'))).comments.length, 0);

		const unblock = await json(await s.call('mod', 'DELETE', `/api/channels/${CH}/blocks/troll`));
		assert.equal(unblock.removed, true);
		await s.call('troll', 'POST', '/api/videos/v1/comments', { text: 'again' }, { channelId: 'troll-ch' });
		assert.equal(publicCommentsCount(s.video().comments), 1, 'published once unblocked');
	});
});

describe('undoing a post delete (Story 29.4)', () => {
	const del = (s: Awaited<ReturnType<typeof setup>>, userId: string) => s.call(userId, 'DELETE', `/api/community/channels/${CH}/posts/p1`, undefined, { channelId: CH });
	const restore = (s: Awaited<ReturnType<typeof setup>>, userId: string) => s.call(userId, 'POST', `/api/community/channels/${CH}/posts/p1/restore`, undefined, { channelId: CH });

	it('brings the post back in its place with its comments; only post.manage may, and only once', async () => {
		const s = await setup();
		await s.ready();
		assert.equal((await s.call('u1', 'POST', `/api/community/channels/${CH}/posts/p1/comments`, { content: 'hi' }, { channelId: 'u1-ch' })).status, 201);
		assert.equal(s.rows("target_kind = 'post'").length, 1);

		assert.equal((await del(s, 'sara')).status, 200);
		assert.equal(s.raw.community_posts.read(`posts/${CH}/p1.json`).status, 'deleted');
		assert.deepEqual(s.raw.community_posts.read(`posts/${CH}/index.json`).postIds, []);
		assert.equal(s.rows("target_kind = 'post'").length, 0, 'rows dropped with the post');

		assert.equal((await restore(s, 'mod')).status, 403, 'a moderator cannot');
		assert.equal((await restore(s, 'u1')).status, 403, 'a stranger cannot');
		const res = await restore(s, 'sara');
		assert.equal(res.status, 200, await res.clone().text());
		const post = s.raw.community_posts.read(`posts/${CH}/p1.json`);
		assert.equal(post.status, 'published');
		assert.equal(post.ownerDeletion, undefined);
		assert.deepEqual(s.raw.community_posts.read(`posts/${CH}/index.json`).postIds, ['p1']);
		assert.equal(s.rows("target_kind = 'post'").length, 1, 'its comments are indexed again');
		assert.equal(s.db.db.prepare(`SELECT COUNT(*) AS n FROM admin_deletions WHERE kind = 'post' AND target_id = 'p1'`).get().n, 0, 'no longer in the trash');
		assert.equal(s.raw.queue.messages.filter((m: any) => m.type === MessageType.CommunityPostCreated).length, 0, 'subscribers are not told again');

		assert.equal((await restore(s, 'sara')).status, 404, 'nothing left to restore');
	});

	it('never undoes an admin removal', async () => {
		const s = await setup();
		assert.equal((await del(s, OWNER)).status, 200);
		const stored = s.raw.community_posts.read(`posts/${CH}/p1.json`);
		await s.raw.community_posts.put(`posts/${CH}/p1.json`, JSON.stringify({ ...stored, adminDeletion: { at: stored.updatedAt, by: 'admin' } }));
		const res = await restore(s, OWNER);
		assert.equal(res.status, 403);
		assert.equal((await json(res)).code, 'deleted_by_admin');
		assert.equal(s.raw.community_posts.read(`posts/${CH}/p1.json`).status, 'deleted');
	});
});

describe('community post comments', () => {
	async function postComment(s: Awaited<ReturnType<typeof setup>>, userId: string, content: string, parentCommentId?: string) {
		const res = await s.call(userId, 'POST', `/api/community/channels/${CH}/posts/p1/comments`, { content, ...(parentCommentId ? { parentCommentId } : {}) }, { channelId: `${userId}-ch` });
		assert.equal(res.status, 201, await res.clone().text());
		return (await json(res)).comment.id as string;
	}
	const count = (s: Awaited<ReturnType<typeof setup>>) => s.raw.community_posts.read(`posts/${CH}/p1.json`).comments;

	it('soft removal by a moderator with its replies, restore, hold and approve; the author still hard-deletes', async () => {
		const s = await setup();
		await s.ready();
		const c1 = await postComment(s, 'u1', 'first');
		const r1 = await postComment(s, 'u1', 'reply', c1);
		const c2 = await postComment(s, 'u1', 'second');
		assert.equal(count(s), 3);
		assert.equal(s.rows("target_kind = 'post'").length, 3, 'indexed on create');

		const del = await s.call('mod', 'DELETE', `/api/community/channels/${CH}/posts/p1/comments/${c1}`);
		assert.equal(del.status, 200);
		assert.equal((await json(del)).removed, true);
		assert.equal(count(s), 1, 'the comment and its reply leave the count');
		const listed = await json(await s.call('u1', 'GET', `/api/community/channels/${CH}/posts/p1/comments`));
		assert.deepEqual(listed.comments.map((c: any) => c.id), [c2]);
		const replies = await json(await s.call('u1', 'GET', `/api/community/channels/${CH}/posts/p1/comments/${c1}/replies`));
		assert.equal(replies.comments.length, 0, 'replies go with their removed thread');
		const removed = await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=removed`));
		assert.deepEqual(removed.items.map((c: any) => c.id), [c1]);
		assert.equal(removed.items[0].targetUrlPath, '/post/p1');

		assert.equal((await s.call(OWNER, 'POST', `/api/community/channels/${CH}/posts/p1/comments/${c1}/restore`)).status, 200);
		assert.equal(count(s), 3, 'restore adds them back');
		assert.equal((await json(await s.call('u1', 'GET', `/api/community/channels/${CH}/posts/p1/comments/${c1}/replies`))).comments[0].id, r1);

		assert.equal((await s.call('mod', 'POST', `/api/community/channels/${CH}/posts/p1/comments/${c2}/hold`)).status, 200);
		assert.equal(count(s), 2);
		assert.deepEqual((await json(await s.call(OWNER, 'GET', `/api/channels/${CH}/comments?tab=held`))).items.map((c: any) => c.id), [c2]);
		assert.equal((await json(await s.call('u1', 'GET', `/api/community/channels/${CH}/posts/p1/comments`))).comments.some((c: any) => c.id === c2), true, 'its author sees it');
		assert.equal((await json(await s.call('troll', 'GET', `/api/community/channels/${CH}/posts/p1/comments`))).comments.some((c: any) => c.id === c2), false);
		assert.equal((await s.call('mod', 'POST', `/api/community/channels/${CH}/posts/p1/comments/${c2}/approve`)).status, 200);
		assert.equal(count(s), 3);

		// An editor may not remove other people's comments
		assert.equal((await s.call('sara', 'DELETE', `/api/community/channels/${CH}/posts/p1/comments/${c2}`)).status, 403);
		// The author: hard delete, never in Removed
		assert.equal((await s.call('u1', 'DELETE', `/api/community/channels/${CH}/posts/p1/comments/${c2}`)).status, 200);
		assert.equal(count(s), 2);
		assert.equal(s.rows('comment_id = ?', c2).length, 0);
		assert.equal((await s.call(OWNER, 'POST', `/api/community/channels/${CH}/posts/p1/comments/${c2}/restore`)).status, 404, 'a deleted comment cannot be restored');
	});
});

describe('daily purge of channel-removed comments', () => {
	it('deletes removed comments older than 90 days from R2 and the index, keeps recent ones', async () => {
		const old = new Date(Date.now() - 91 * DAY).toISOString();
		const recent = new Date(Date.now() - 10 * DAY).toISOString();
		const s = await setup([
			commentFixture('old', { userId: 'u1', channelId: 'u1-ch', isDeleted: true, removedBy: 'channel', removedAt: old, removedByUserId: OWNER }),
			commentFixture('new', { userId: 'u1', channelId: 'u1-ch', isDeleted: true, removedBy: 'channel', removedAt: recent, removedByUserId: OWNER }),
			commentFixture('live', { userId: 'u1', channelId: 'u1-ch' }),
		]);
		const oldPost = { id: 'pc1', postId: 'p1', userId: 'u1', userDisplayName: 'User One', content: 'old', likes: 0, repliesCount: 0, createdAt: old, isDeleted: true, removedBy: 'channel', removedAt: old, removedByUserId: OWNER };
		await s.raw.community_posts.put('comments/p1/top-level/pc1.json', JSON.stringify(oldPost));
		await s.raw.community_posts.put('comment-likes/p1/pc1/u2.json', JSON.stringify({}));
		await s.ready();
		assert.equal(s.rows("status = 'removed'").length, 3);

		await startCommentPurge(s.env as never, s.ctx);
		await s.drain();
		assert.deepEqual(s.video().comments.map((c: any) => c.id), ['new', 'live']);
		assert.equal(s.raw.community_posts.read('comments/p1/top-level/pc1.json'), null);
		assert.equal(s.raw.community_posts.read('comment-likes/p1/pc1/u2.json'), null);
		assert.deepEqual(s.rows("status = 'removed'").map((r) => r.comment_id), ['new']);
		assert.deepEqual(await runPurgeStep(s.env as never), { purged: 0, more: false });
	});
});

describe('erasure', () => {
	it("deletes the person's channel-removed comments, their index rows and blocks of them immediately", async () => {
		const removed = { isDeleted: true, removedBy: 'channel', removedAt: new Date().toISOString(), removedByUserId: OWNER };
		const s = await setup([
			commentFixture('t1', { userId: 'troll', channelId: 'troll-ch', ...removed }),
			commentFixture('t2', { userId: 'troll', channelId: 'troll-ch' }),
			commentFixture('u1c', { userId: 'u1', channelId: 'u1-ch' }),
		]);
		await s.raw.community_posts.put('comments/p1/top-level/tp.json', JSON.stringify({ id: 'tp', postId: 'p1', userId: 'troll', userDisplayName: 'Troll', content: 'x', likes: 0, repliesCount: 0, createdAt: new Date().toISOString(), ...removed }));
		await s.ready();
		await s.call(OWNER, 'POST', `/api/channels/${CH}/blocks`, { userId: 'troll' });
		await s.call(OWNER, 'POST', `/api/channels/${CH}/comments/bulk`, { action: 'hold', items: [{ kind: 'video', targetId: 'v1', commentId: 'u1c' }] });
		assert.ok(s.rows('author_user_id = ?', 'troll').length >= 2);

		const env = { ...s.env, channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), watch_history: new MemoryBucket(), 'upload-defaults': new MemoryBucket(), reports: new MemoryBucket(), subtitles: new MemoryBucket() };
		await eraseUserData(env as never, 'troll', new OperationBudget(10_000));
		await s.flush();
		const ids = s.video().comments.map((c: any) => c.id);
		assert.ok(!ids.includes('t1'), 'the removed comment is deleted, not anonymised');
		assert.ok(ids.includes('t2'), 'a live comment is anonymised as before');
		assert.equal(s.raw.community_posts.read('comments/p1/top-level/tp.json'), null);
		assert.equal(s.rows('author_user_id = ?', 'troll').length, 0);
		assert.equal(Number((s.db.db.prepare('SELECT COUNT(*) AS n FROM channel_blocks WHERE user_id = ?').get('troll') as any).n), 0);
		assert.equal(s.rows('comment_id = ?', 'u1c').length, 1, "other people's rows stay");
	});
});

describe('community post writes by channel members (post.manage)', () => {
	it('owner, admin and editor create, edit and delete posts; moderator and strangers are refused', async () => {
		const s = await setup();
		for (const [userId, status] of [[OWNER, 200], ['ali', 200], ['sara', 200], ['mod', 403], ['u1', 403]] as const) {
			const res = await s.call(userId, 'POST', `/api/community/channels/${CH}/posts`, { type: 'text', content: `by ${userId}` }, { channelId: CH });
			assert.equal(res.status, status, `${userId}: ${await res.clone().text()}`);
			if (status === 200) {
				const created = (await json(res)).post;
				const stored = s.raw.community_posts.read(`posts/${CH}/${created.id}.json`);
				assert.equal(stored.userId, OWNER, 'the post belongs to the channel owner');
				if (userId !== OWNER) assert.equal(stored.authorId, userId);
			}
		}
		for (const [userId, status] of [['ali', 200], ['sara', 200], ['mod', 403], ['u1', 403]] as const) {
			const res = await s.call(userId, 'PUT', `/api/community/channels/${CH}/posts/p1`, { content: `edited by ${userId}` }, { channelId: CH });
			assert.equal(res.status, status, `${userId}: ${await res.clone().text()}`);
		}
		assert.equal((await s.call('mod', 'DELETE', `/api/community/channels/${CH}/posts/p1`, undefined, { channelId: CH })).status, 403);
		assert.equal((await s.call('u1', 'DELETE', `/api/community/channels/${CH}/posts/p1`, undefined, { channelId: CH })).status, 403);
		assert.equal((await s.call('sara', 'DELETE', `/api/community/channels/${CH}/posts/p1`, undefined, { channelId: CH })).status, 200);
	});
});
