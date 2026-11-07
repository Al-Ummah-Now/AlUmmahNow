/**
 * Story 29.1 (@handles, About, channel delete) and 29.2 (comments completion).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	claimHandle,
	defaultHandleCandidates,
	handleKey,
	normalizeHandleInput,
	validateHandleFormat,
} from '../src/lib/channelHandles';
import { buildChannelAbout, isChannelVisibleTo, safeChannelLinks } from '../src/lib/channelAbout';
import { pickNewMainChannel } from '../src/lib/channelDeletion';
import { findStoredComment, getCommentSettings, paginateComments, paginateReplies, removeStoredComment, sortComments } from '../src/lib/comments';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { ChannelDelete } from '../src/endpoints/channel/channelDelete';
import { ChannelAbout, ChannelByHandleFetch, ChannelHandleAvailability, ChannelHandlesBackfill } from '../src/endpoints/channel/channelHandle';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentRepliesList } from '../src/endpoints/video/commentRepliesList';
import { CommentApprove } from '../src/endpoints/video/commentApprove';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';

function env(buckets: Record<string, MemoryBucket> = {}) {
	return {
		videos: buckets.videos ?? new MemoryBucket(),
		channels: buckets.channels ?? new MemoryBucket(),
		profiles: buckets.profiles ?? new MemoryBucket(),
		channel_tabs: buckets.channel_tabs ?? new MemoryBucket(),
		playlists: buckets.playlists ?? new MemoryBucket(),
		community_posts: buckets.community_posts ?? new MemoryBucket(),
		channel_sections: buckets.channel_sections ?? new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

function channel(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id, userId: 'owner', email: 'o@test.local', name: `Channel ${id}`, isMain: false,
		dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z',
		playlists: [], videos: [], subscribers: [], subscriptions: [], likes: [],
		...overrides,
	};
}

const json = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('handle validation', () => {
	it('accepts 3-30 Latin letters, digits and . _ -', () => {
		assert.equal(validateHandleFormat('abc'), null);
		assert.equal(validateHandleFormat('@Al.Noor_Channel-1'), null);
		assert.equal(validateHandleFormat('a'.repeat(30)), null);
	});

	it('rejects short, long, non-Latin, edge punctuation and reserved handles', () => {
		assert.equal(validateHandleFormat('ab'), 'too_short');
		assert.equal(validateHandleFormat('a'.repeat(31)), 'too_long');
		assert.equal(validateHandleFormat('قن'), 'too_short');
		assert.equal(validateHandleFormat('قناةالنور'), 'invalid_characters');
		assert.equal(validateHandleFormat('has space'), 'invalid_characters');
		assert.equal(validateHandleFormat('.dot'), 'invalid_characters');
		assert.equal(validateHandleFormat('dash-'), 'invalid_characters');
		assert.equal(validateHandleFormat('Admin'), 'reserved');
		assert.equal(validateHandleFormat('settings'), 'reserved');
	});

	it('indexes case-insensitively', () => {
		assert.equal(normalizeHandleInput('  @@Noor '), 'Noor');
		assert.equal(handleKey('@NoOr'), handleKey('noor'));
	});

	it('builds default candidates from the Latin name, falling back to the id', () => {
		assert.deepEqual(defaultHandleCandidates({ id: 'abcdef1234567890', name: 'Al Noor TV!' }).slice(0, 2), ['AlNoorTV', 'AlNoorTV-abcd']);
		const arabic = defaultHandleCandidates({ id: 'abcdef1234567890', name: 'قناة النور' });
		assert.equal(arabic[0], 'channel-abcdef12');
	});

	it('claims case-insensitively unique handles', async () => {
		const bucket = new MemoryBucket();
		assert.deepEqual(await claimHandle(bucket as any, 'Noor', { id: 'c1', userId: 'u1' }), { ok: true, handle: 'Noor' });
		assert.deepEqual(await claimHandle(bucket as any, 'NOOR', { id: 'c2', userId: 'u2' }), { ok: false, reason: 'taken' });
		// Same channel may change the casing
		assert.deepEqual(await claimHandle(bucket as any, 'NOOR', { id: 'c1', userId: 'u1' }), { ok: true, handle: 'NOOR' });
	});
});

describe('channel handle endpoints', () => {
	function routes(r: any) {
		r.get('/api/channels/handles/:handle/availability', ChannelHandleAvailability);
		r.get('/api/channels/by-handle/:handle', ChannelByHandleFetch);
		r.put('/api/channels/:id', ChannelUpdate);
		r.get('/api/channels/:id/about', ChannelAbout);
		r.post('/internal/channels/backfill-handles', ChannelHandlesBackfill);
	}

	it('claims, changes and releases a handle on update; resolves by handle', async () => {
		const e = env({ channels: new MemoryBucket({ c1: channel('c1'), c2: channel('c2', { userId: 'other' }) }) });
		const owner = buildApp(routes, { userId: 'owner' });

		let res = await owner.request('/api/channels/c1', json({ handle: '@Noor' }), e);
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as any).result.channel.handle, 'Noor');
		assert.equal(e.channel_tabs.read('channel-handles/noor').channelId, 'c1');

		const byHandle = await owner.request('/api/channels/by-handle/nOoR', {}, e);
		assert.equal(byHandle.status, 200);
		assert.equal(((await byHandle.json()) as any).id, 'c1');

		res = await owner.request('/api/channels/c1', json({ handle: 'NoorTV' }), e);
		assert.equal(res.status, 200);
		assert.equal(e.channel_tabs.read('channel-handles/noor'), null, 'old handle released');
		assert.equal((await owner.request('/api/channels/by-handle/noor', {}, e)).status, 404);

		// Someone else can't take it
		const other = buildApp(routes, { userId: 'other' });
		res = await other.request('/api/channels/c2', json({ handle: 'noortv' }), e);
		assert.equal(res.status, 409);
		assert.deepEqual(await res.json(), { success: false, error: 'handle_unavailable', reason: 'taken' });

		const avail = await (await other.request('/api/channels/handles/noortv/availability?channelId=c1', {}, e)).json() as any;
		assert.equal(avail.result.available, true, 'own handle counts as available');
		const reserved = await (await other.request('/api/channels/handles/admin/availability', {}, e)).json() as any;
		assert.deepEqual(reserved.result, { available: false, handle: 'admin', reason: 'reserved' });
	});

	it('stores About fields and returns them with totals', async () => {
		const e = env({
			channels: new MemoryBucket({ c1: channel('c1', { description: 'desc', descriptionLocalized: { ar: 'وصف' }, subscribers: [{ channelId: 'a' }, { channelId: 'b' }] }) }),
			videos: new MemoryBucket({
				v1: videoFixture({ id: 'v1', channelId: 'c1', views: 10 }),
				v2: videoFixture({ id: 'v2', channelId: 'c1', views: 5 }),
				v3: videoFixture({ id: 'v3', channelId: 'c1', views: 100, isPublic: false }),
				v4: videoFixture({ id: 'v4', channelId: 'other', views: 7 }),
			}),
		});
		const app = buildApp(routes, { userId: 'owner' });
		const res = await app.request('/api/channels/c1', json({
			links: [{ title: 'Site', url: 'https://example.org' }],
			contactEmail: 'hello@example.org',
			location: 'Cairo',
		}), e);
		assert.equal(res.status, 200);

		const rejected = await app.request('/api/channels/c1', json({ links: [{ title: 'x', url: 'javascript:alert(1)' }] }), e);
		assert.equal(rejected.status, 400);

		const about = await (await buildApp(routes, null).request('/api/channels/c1/about', {}, e)).json() as any;
		assert.deepEqual(about.result.links, [{ title: 'Site', url: 'https://example.org' }]);
		assert.equal(about.result.contactEmail, 'hello@example.org');
		assert.equal(about.result.location, 'Cairo');
		assert.equal(about.result.descriptionLocalized.ar, 'وصف');
		assert.equal(about.result.totalViews, 15);
		assert.equal(about.result.videosCount, 2);
		assert.equal(about.result.subscribersCount, 2);
		assert.equal(about.result.joinedDate, '2026-01-01T00:00:00.000Z');

		await app.request('/api/channels/c1', json({ contactEmail: '', location: '' }), e);
		const cleared = await (await app.request('/api/channels/c1/about', {}, e)).json() as any;
		assert.equal(cleared.result.contactEmail, null);
		assert.equal(cleared.result.location, null);
	});

	it('backfills default handles idempotently', async () => {
		const e = env({ channels: new MemoryBucket({ c1: channel('c1abcdefgh', { id: 'c1abcdefgh', name: 'Noor' }), c2: channel('c2', { handle: 'kept' }) }) });
		const app = buildApp(routes, null);
		const first = await (await app.request('/internal/channels/backfill-handles', { method: 'POST' }, e)).json() as any;
		assert.deepEqual(first.result.assigned, [{ channelId: 'c1abcdefgh', handle: 'Noor' }]);
		assert.equal(first.result.repaired, 1, 'missing index entry for an existing handle is restored');
		assert.equal(e.channels.read('c1').handle, 'Noor');
		const second = await (await app.request('/internal/channels/backfill-handles', { method: 'POST' }, e)).json() as any;
		assert.equal(second.result.assigned.length, 0);
	});

	it('hides deleted, hidden and other people\'s private channels', () => {
		assert.equal(isChannelVisibleTo({ isDeleted: true }), false);
		assert.equal(isChannelVisibleTo({ isHidden: true, userId: 'u' }, 'u'), false);
		assert.equal(isChannelVisibleTo({ isPrivate: true, userId: 'u' }, 'x'), false);
		assert.equal(isChannelVisibleTo({ isPrivate: true, userId: 'u' }, 'u'), true);
	});

	it('only exposes http(s) links', () => {
		assert.deepEqual(safeChannelLinks([{ title: 'a', url: 'ftp://x' }, { title: 'b', url: 'http://ok' }]), [{ title: 'b', url: 'http://ok' }]);
		assert.equal(buildChannelAbout({ id: 'c', dateCreated: 'd' }, { totalViews: 0, videosCount: 0, partial: false }).handle, null);
	});
});

describe('channel delete', () => {
	function routes(r: any) {
		r.delete('/api/channels/:id', ChannelDelete);
	}

	it('enforces ownership', async () => {
		const e = env({ channels: new MemoryBucket({ c1: channel('c1') }) });
		const res = await buildApp(routes, { userId: 'intruder' }).request('/api/channels/c1', { method: 'DELETE' }, e);
		assert.equal(res.status, 403);
		assert.ok(e.channels.read('c1'));
	});

	it('promotes the oldest remaining channel when the main channel is deleted and frees the handle', async () => {
		const e = env({
			channels: new MemoryBucket({
				main: channel('main', { isMain: true, handle: 'MainOne' }),
				newer: channel('newer', { dateCreated: '2026-03-01T00:00:00.000Z' }),
				older: channel('older', { dateCreated: '2026-02-01T00:00:00.000Z' }),
			}),
			channel_tabs: new MemoryBucket({ 'channel-handles/mainone': { handle: 'MainOne', channelId: 'main', userId: 'owner' } }),
			profiles: new MemoryBucket({ owner: { id: 'owner', email: 'o@test.local', channels: ['main', 'newer', 'older'] } }),
		});
		const res = await buildApp(routes, { userId: 'owner' }).request('/api/channels/main', { method: 'DELETE' }, e);
		assert.equal(res.status, 200);
		assert.deepEqual(((await res.json()) as any).result, { deletedChannelId: 'main', newMainChannelId: 'older' });
		assert.equal(e.channels.read('main'), null);
		assert.equal(e.channels.read('older').isMain, true);
		assert.equal(e.channel_tabs.read('channel-handles/mainone'), null);
		assert.deepEqual(e.profiles.read('owner').channels, ['newer', 'older']);
	});

	it('honours newMainChannelId and allows deleting the only channel', async () => {
		assert.equal(pickNewMainChannel([{ id: 'a', userId: 'u' }, { id: 'b', userId: 'u' }, { id: 'm', userId: 'u' }], 'm', 'b')?.id, 'b');
		assert.equal(pickNewMainChannel([{ id: 'm', userId: 'u' }], 'm'), null);
		const e = env({ channels: new MemoryBucket({ only: channel('only', { isMain: true }) }) });
		const res = await buildApp(routes, { userId: 'owner' }).request('/api/channels/only', { method: 'DELETE' }, e);
		assert.equal(((await res.json()) as any).result.newMainChannelId, null);
	});
});

describe('comment helpers', () => {
	const a = commentFixture('a', { dateCreated: '2026-01-01T00:00:00Z', likes: [{ channelId: 'x' }, { channelId: 'y' }] });
	const b = commentFixture('b', { dateCreated: '2026-01-03T00:00:00Z' });
	const c = commentFixture('c', { dateCreated: '2026-01-02T00:00:00Z', likes: [{ channelId: 'x' }], replies: [commentFixture('r1', { parentCommentId: 'c' })] });

	it('sorts by top (net likes) or newest', () => {
		assert.deepEqual(sortComments([a, b, c] as any, 'top').map((x) => x.id), ['a', 'c', 'b']);
		assert.deepEqual(sortComments([a, b, c] as any, 'newest').map((x) => x.id), ['b', 'c', 'a']);
	});

	it('shows held comments to their author and the video owner only', () => {
		const held = commentFixture('h', { status: 'held', userId: 'author' });
		assert.equal(paginateComments([held] as any, 10).total, 0);
		assert.equal(paginateComments([held] as any, 10, null, 'newest', { userId: 'author' }).total, 1);
		assert.equal(paginateComments([held] as any, 10, null, 'newest', { userId: 'owner', isVideoOwner: true }).total, 1);
	});

	it('finds and removes replies', () => {
		const list = [a, b, c] as any[];
		assert.equal(findStoredComment(list, 'r1')?.parent?.id, 'c');
		assert.equal(paginateReplies(c as any).total, 1);
		const { removed } = removeStoredComment(list, 'r1');
		assert.equal(removed, true);
		assert.equal(c.replies.length, 0);
	});

	it('defaults comment settings to on', () => {
		assert.equal(getCommentSettings({}), 'on');
		assert.equal(getCommentSettings({ commentSettings: 'held' }), 'held');
		assert.equal(getCommentSettings({ commentSettings: 'nonsense' }), 'on');
	});
});

describe('comment endpoints (replies, sort, settings)', () => {
	function routes(r: any) {
		r.get('/api/videos/:id/comments', CommentList);
		r.post('/api/videos/:id/comments', CommentCreate);
		r.get('/api/videos/:id/comments/:cid/replies', CommentRepliesList);
		r.post('/api/videos/:id/comments/:cid/approve', CommentApprove);
		r.put('/api/videos/:id/comments/:cid', CommentUpdate);
		r.delete('/api/videos/:id/comments/:cid', CommentDelete);
		r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
	}
	const post = (body: unknown, channelId = 'viewer-ch') => ({ method: 'POST', headers: { 'Content-Type': 'application/json', channelId }, body: JSON.stringify(body) });

	it('creates one-level replies, lists them oldest first and supports edit/like/delete on replies', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ comments: [commentFixture('top')] }) }) });
		const viewer = buildApp(routes, { userId: 'viewer' });

		const r1 = await (await viewer.request('/api/videos/v1/comments', post({ text: 'first reply', parentCommentId: 'top' }), e)).json() as any;
		assert.equal(r1.result.comment.parentCommentId, 'top');
		// Replying to a reply attaches to the top-level comment
		const r2 = await (await viewer.request('/api/videos/v1/comments', post({ text: 'second', parentCommentId: r1.result.comment.id }), e)).json() as any;
		assert.equal(r2.result.comment.parentCommentId, 'top');

		const list = await (await viewer.request('/api/videos/v1/comments', {}, e)).json() as any;
		assert.equal(list.result.comments.length, 1);
		assert.equal(list.result.comments[0].repliesCount, 2);
		assert.equal(list.result.commentSettings, 'on');

		const replies = await (await viewer.request('/api/videos/v1/comments/top/replies', {}, e)).json() as any;
		assert.deepEqual(replies.result.replies.map((r: any) => r.text), ['first reply', 'second']);

		const edited = await viewer.request(`/api/videos/v1/comments/${r1.result.comment.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', channelId: 'viewer-ch' }, body: JSON.stringify({ text: 'edited reply' }) }, e);
		assert.equal(edited.status, 200);
		const liked = await viewer.request(`/api/videos/v1/comments/${r1.result.comment.id}/likes`, { method: 'POST', headers: { channelId: 'viewer-ch' } }, e);
		assert.equal(((await liked.json()) as any).result.likesCount, 1);
		const after = await (await viewer.request('/api/videos/v1/comments/top/replies', {}, e)).json() as any;
		assert.equal(after.result.replies[0].text, 'edited reply');
		assert.equal(after.result.replies[0].isEdited, true);

		const del = await viewer.request(`/api/videos/v1/comments/${r2.result.comment.id}`, { method: 'DELETE', headers: { channelId: 'viewer-ch' } }, e);
		assert.equal(del.status, 200);
		assert.equal(((await (await viewer.request('/api/videos/v1/comments/top/replies', {}, e)).json()) as any).result.total, 1);
	});

	it('sorts top comments first with ?sort=top', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ comments: [
			commentFixture('new', { dateCreated: '2026-02-01T00:00:00Z' }),
			commentFixture('liked', { dateCreated: '2026-01-01T00:00:00Z', likes: [{ id: 'l', userId: 'u', channelId: 'x' }] }),
		] }) }) });
		const app = buildApp(routes, null);
		const top = await (await app.request('/api/videos/v1/comments?sort=top', {}, e)).json() as any;
		assert.deepEqual(top.result.comments.map((c: any) => c.id), ['liked', 'new']);
		assert.equal(top.result.sort, 'top');
		const newest = await (await app.request('/api/videos/v1/comments', {}, e)).json() as any;
		assert.deepEqual(newest.result.comments.map((c: any) => c.id), ['new', 'liked']);
	});

	it('rejects comments when settings are off and hides existing ones', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ commentSettings: 'off', comments: [commentFixture('old')] }) }) });
		const viewer = buildApp(routes, { userId: 'viewer' });
		const res = await viewer.request('/api/videos/v1/comments', post({ text: 'hi' }), e);
		assert.equal(res.status, 403);
		assert.equal(((await res.json()) as any).error, 'comments_disabled');
		const list = await (await viewer.request('/api/videos/v1/comments', {}, e)).json() as any;
		assert.equal(list.result.total, 0);
		assert.equal(list.result.commentSettings, 'off');
	});

	it('holds comments for review until the owner approves them', async () => {
		const e = env({ videos: new MemoryBucket({ v1: videoFixture({ commentSettings: 'held' }) }) });
		const viewer = buildApp(routes, { userId: 'viewer' });
		const owner = buildApp(routes, { userId: 'owner' });
		const anon = buildApp(routes, null);

		const created = await (await viewer.request('/api/videos/v1/comments', post({ text: 'please review' }), e)).json() as any;
		assert.equal(created.result.comment.isHeld, true);
		const cid = created.result.comment.id;

		assert.equal(((await (await anon.request('/api/videos/v1/comments', {}, e)).json()) as any).result.total, 0);
		assert.equal(((await (await viewer.request('/api/videos/v1/comments', {}, e)).json()) as any).result.total, 1);
		assert.equal(((await (await owner.request('/api/videos/v1/comments', {}, e)).json()) as any).result.comments[0].isHeld, true);

		assert.equal((await viewer.request(`/api/videos/v1/comments/${cid}/approve`, { method: 'POST' }, e)).status, 403);
		assert.equal((await owner.request(`/api/videos/v1/comments/${cid}/approve`, { method: 'POST' }, e)).status, 200);
		const publicList = await (await anon.request('/api/videos/v1/comments', {}, e)).json() as any;
		assert.equal(publicList.result.total, 1);
		assert.equal(publicList.result.comments[0].isHeld, false);

		// The owner's own comments are never held
		const own = await (await owner.request('/api/videos/v1/comments', post({ text: 'owner says' }, 'owner-ch'), e)).json() as any;
		assert.equal(own.result.comment.isHeld, false);
	});
});
