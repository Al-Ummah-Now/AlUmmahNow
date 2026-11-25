/**
 * What is on a channel belongs to the channel's owner now (lib/channelAccess.ts): records that still
 * name an earlier owner give that account nothing, and the owner and members of today everything.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { ownershipCompleteKey } from '@al-ummah/shared-types';
import { channelVideoIds, ownVideoIds, runOwnershipPass, videoListIds } from '../src/lib/search/ownership';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { PlaylistQueue } from '../src/endpoints/playlist/playlistQueue';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { PlaylistDelete } from '../src/endpoints/playlist/playlistDelete';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import { PlaylistRemoveVideo } from '../src/endpoints/playlist/playlistRemoveVideo';
import { PlaylistManageItems, PlaylistVideosBulkAdd, PlaylistVideosBulkRemove, PlaylistVideosReorder } from '../src/endpoints/playlist/playlistBulk';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { GetCommunityPost } from '../src/endpoints/community/get-post';
import { ListCommunityPosts } from '../src/endpoints/community/list-posts';
import { UpdatePostComment } from '../src/endpoints/community/post-comment-update';
import { CommentUpdate } from '../src/endpoints/video/commentUpdate';
import { VideoPermanentDelete } from '../src/endpoints/video/videoPermanentDelete';
import { LiveStreamsList } from '../src/endpoints/live/liveStreamsList';
import { canManageLiveStream, canManagePlaylist, canOnVideo, maySpeakAs, memoChannels, ownsRecord } from '../src/lib/channelAccess';
import { CommentDelete } from '../src/endpoints/video/commentDelete';
import { DeletePostComment } from '../src/endpoints/community/post-comment-delete';
import { CommentList } from '../src/endpoints/video/commentList';
import { CommentRepliesList } from '../src/endpoints/video/commentRepliesList';
import { CommentCreate } from '../src/endpoints/video/commentCreate';
import { CommentLikeCreate } from '../src/endpoints/video/commentLikeCreate';
import { VideoView } from '../src/endpoints/video/videoView';
import { VideoWatchTime } from '../src/endpoints/video/videoWatchTime';
import { VideoRetention } from '../src/endpoints/video/videoRetention';
import { VideosList } from '../src/endpoints/video/videoList';
import { VideoSearch } from '../src/endpoints/video/videoSearch';
import { VideoScheduleList } from '../src/endpoints/video/scheduleList';
import { UploadFailedEndpoint } from '../src/endpoints/video/uploadFailed';
import { chatRole, forgetChatTiers, ownerTierHasChat, type ChatStream } from '../src/lib/live/chat';
import { withLiveVideoFields } from '../src/lib/watch-history';
import { loadOwnedVideos } from '../src/lib/analytics';
import { can, markCategorySuggestionPending } from '@al-ummah/shared-types';
import { createSqliteD1 } from './sqlite-d1';
import { saveTier } from '../src/lib/creatorTiers';
import { uploaderProcessingIssue } from '../src/lib/transformations';
import { CategorySuggestionGet } from '../src/endpoints/video/categorySuggestions';
import { LikedVideosList } from '../src/endpoints/library/liked';
import { ContinueWatchingList, WatchStatePut } from '../src/endpoints/watch-state/watchState';
import { moveOutcome, moveOutcomeOfRow } from '../src/lib/channelMoveOutcome';
import { resolvePlaylistCovers } from '../src/lib/playlistCovers';

const BEFORE = 'usr_before';
const NOW = 'usr_now';
const EDITOR = 'usr_editor';

function seed() {
	const pl = (id: string, overrides: Record<string, unknown> = {}) => ({ id, title: id, userId: BEFORE, channelId: 'ch1', videos: ['v1'], isPublic: false, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides });
	return {
		// Moved: the records below still name the owner before
		channels: new MemoryBucket({
			ch1: { id: 'ch1', userId: NOW, name: 'Moved', members: [{ userId: EDITOR, role: 'editor' }], transferredAt: '2026-01-02T00:00:00.000Z' },
			own: { id: 'own', userId: BEFORE, name: 'Own' },
			broken: null,
		}),
		playlists: new MemoryBucket({
			pl1: pl('pl1'),
			'pl-own': pl('pl-own', { channelId: 'own' }),
			'pl-personal': pl('pl-personal', { channelId: '' }),
			'pl-orphan': pl('pl-orphan', { channelId: 'gone' }),
			'pl-broken': pl('pl-broken', { channelId: 'broken' }),
		}),
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', userId: BEFORE, channelId: 'ch1', isPublic: true, comments: [commentFixture('c-before', { userId: BEFORE, channelId: 'ch1', text: 'as the channel', replies: [commentFixture('r-1', { userId: 'usr_x', channelId: null, text: 'reply' })] }), commentFixture('c-gone', { userId: BEFORE, channelId: 'gone', text: 'as a channel that is gone' }), commentFixture('c-self', { userId: BEFORE, channelId: 'own', text: 'as own' }), commentFixture('c-viewer', { userId: BEFORE, channelId: BEFORE, text: 'as a member' })] }),
			'livestream:s1': { id: 's1', title: 'stream', userId: BEFORE, channelId: 'ch1', status: 'scheduled', isPrivate: true, dateCreated: '2026-01-01T00:00:00.000Z' },
			'livestream:s-own': { id: 's-own', title: 'stream', userId: BEFORE, channelId: 'own', status: 'scheduled', isPrivate: true, dateCreated: '2026-01-01T00:00:00.000Z' },
		}),
		community_posts: new MemoryBucket({
			'posts/ch1/p1.json': { id: 'p1', channelId: 'ch1', userId: BEFORE, type: 'text', content: 'later', status: 'scheduled', scheduledAt: '2999-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
			'posts/ch1/index.json': { postIds: ['p1'], lastUpdated: 'x' },
			'comments/px/top-level/pc1.json': { id: 'pc1', postId: 'px', userId: BEFORE, channelId: 'ch1', content: 'as the channel', createdAt: '2026-01-01T00:00:00.000Z' },
		}),
		profiles: new MemoryBucket(),
		channel_tabs: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new MemoryQueue(),
	};
}

const routes = (r: any) => {
	r.get('/api/playlists', PlaylistsList);
	r.get('/api/playlists/:id', PlaylistFetch);
	r.get('/api/playlists/:id/queue', PlaylistQueue);
	r.get('/api/playlists/:id/items', PlaylistManageItems);
	r.put('/api/playlists/:id', PlaylistUpdate);
	r.delete('/api/playlists/:id', PlaylistDelete);
	r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	r.delete('/api/playlists/:id/videos/:videoId', PlaylistRemoveVideo);
	r.post('/api/playlists/:id/videos/bulk', PlaylistVideosBulkAdd);
	r.delete('/api/playlists/:id/videos/bulk', PlaylistVideosBulkRemove);
	r.put('/api/playlists/:id/order', PlaylistVideosReorder);
	r.get('/api/channels/:id/playlists', ChannelPlaylistsList);
	r.get('/api/community/channels/:channelId/posts', ListCommunityPosts);
	r.get('/api/community/channels/:channelId/posts/:postId', GetCommunityPost);
	r.put('/api/community/channels/:channelId/posts/:postId/comments/:commentId', UpdatePostComment);
	r.put('/api/videos/:id/comments/:cid', CommentUpdate);
	r.delete('/api/videos/:id/comments/:cid', CommentDelete);
	r.delete('/api/community/channels/:channelId/posts/:postId/comments/:commentId', DeletePostComment);
	r.delete('/api/videos/:id/permanent', VideoPermanentDelete);
	r.get('/api/live-streams', LiveStreamsList);
};

async function setup(indexed: boolean) {
	const b = seed();
	const db = new SqliteD1();
	const env = { ...b, ...(indexed ? { SEARCH_DB: db } : {}) };
	if (indexed) for (const kind of ['playlist', 'stream', 'channel', 'video'] as const) await runOwnershipPass(env as never, kind, { maxPages: 10 });
	const call = async (userId: string | null, method: string, path: string, body?: unknown) => {
		const res = await buildApp(routes, userId ? { userId } : null).request(path, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
		const text = await res.text();
		let json: any = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = text;
		}
		return { status: res.status, body: json };
	};
	return { b, env, call };
}

describe('playlists of a channel that moved', () => {
	const CHANGES: Array<[string, string, unknown?]> = [
		['PUT', '/api/playlists/pl1', { title: 'changed' }],
		['POST', '/api/playlists/pl1/videos', { videoId: 'v1' }],
		['DELETE', '/api/playlists/pl1/videos/v1'],
		['POST', '/api/playlists/pl1/videos/bulk', { videoIds: ['v1'], ids: ['v1'] }],
		['PUT', '/api/playlists/pl1/order', { videoIds: ['v1'], videos: ['v1'], ids: ['v1'] }],
		['GET', '/api/playlists/pl1/items'],
		['DELETE', '/api/playlists/pl1'],
	];

	it('refuse every change by the owner before', async () => {
		const { b, call } = await setup(true);
		const stored = b.playlists.store.get('pl1');
		for (const [method, path, body] of CHANGES) {
			const res = await call(BEFORE, method, path, body);
			assert.ok([401, 403, 404].includes(res.status), `${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
		}
		assert.equal(b.playlists.store.get('pl1'), stored);
	});

	it('are the owner\'s of today and their members\'', async () => {
		for (const who of [NOW, EDITOR]) {
			const { b, call } = await setup(true);
			assert.equal((await call(who, 'GET', '/api/playlists/pl1')).status, 200, who);
			assert.equal((await call(who, 'GET', '/api/playlists/pl1/queue')).status, 200, who);
			assert.equal((await call(who, 'PUT', '/api/playlists/pl1', { title: 'changed' })).status, 200, who);
			assert.equal(b.playlists.read('pl1').title, 'changed');
			assert.equal((await call(who, 'DELETE', '/api/playlists/pl1')).status, 200, who);
		}
	});

	for (const indexed of [true, false]) {
		it(`stay private from the owner before, opened or listed (${indexed ? 'index' : 'scan'})`, async () => {
			const { call } = await setup(indexed);
			assert.equal((await call(BEFORE, 'GET', '/api/playlists/pl1')).status, 404);
			assert.equal((await call(BEFORE, 'GET', '/api/playlists/pl1/queue')).status, 404);
			const listed = async (who: string, path: string) => ((await call(who, 'GET', path)).body.data ?? (await call(who, 'GET', path)).body.result?.data ?? []).map((p: { id: string }) => p.id).sort();
			assert.deepEqual(await listed(BEFORE, '/api/playlists?channelId=ch1'), []);
			assert.deepEqual(await listed(NOW, '/api/playlists?channelId=ch1'), ['pl1']);
			assert.deepEqual(await listed(EDITOR, '/api/playlists?channelId=ch1'), ['pl1']);
			assert.deepEqual(await listed(BEFORE, '/api/playlists'), ['pl-orphan', 'pl-own', 'pl-personal'], 'their own still');
			assert.deepEqual(await listed(BEFORE, '/api/playlists?channelId=own'), ['pl-own']);
			assert.deepEqual(await listed(NOW, '/api/playlists'), ['pl1'], 'the new owner sees it without a filter too');
			assert.deepEqual(await listed(EDITOR, '/api/playlists'), [], 'a member through the channel filter only, as before');
		});
	}

	it('personal and watch-later lists, and those of a channel that is gone, stay their owner\'s', async () => {
		const { env } = await setup(false);
		const may = (playlist: Record<string, unknown>, who = BEFORE) => canManagePlaylist(env as never, { userId: BEFORE, ...playlist }, who);
		assert.equal(await may({ channelId: '' }), true);
		assert.equal(await may({ id: 'watch-later-usr_before', channelId: 'ch1', systemType: 'watch_later' }), true);
		assert.equal(await may({ channelId: 'gone' }), true);
		assert.equal(await may({ channelId: 'own' }), true);
		assert.equal(await may({ channelId: 'ch1' }), false);
		assert.equal(await may({ channelId: 'broken' }), false, 'an unreadable channel refuses');
		assert.equal(await may({ channelId: 'gone' }, NOW), false);
		assert.equal(await may({ id: 'watch-later-usr_before', channelId: 'ch1', systemType: 'watch_later' }, NOW), false, 'never a channel\'s');
	});
});

describe('videos, streams, posts and comments of a channel that moved', () => {
	it('videos and streams answer to the owner of today', async () => {
		const { env } = await setup(false);
		const record = { userId: BEFORE, channelId: 'ch1', uploadedBy: BEFORE };
		for (const capability of ['video.edit', 'video.delete', 'video.view_private', 'comment.moderate', 'video.schedule'] as const) {
			assert.equal(await canOnVideo(env as never, record, BEFORE, capability), false, capability);
			assert.equal(await canOnVideo(env as never, record, NOW, capability), true, capability);
		}
		assert.equal(await canManageLiveStream(env as never, record, BEFORE), false);
		assert.equal(await canManageLiveStream(env as never, record, NOW), true);
		assert.equal(await ownsRecord(env as never, record, BEFORE), false);
		assert.equal(await ownsRecord(env as never, record, NOW), true);
		assert.equal(await ownsRecord(env as never, record, EDITOR), false, 'a member is not the owner');
		assert.equal(await canOnVideo(env as never, { userId: BEFORE, channelId: null }, BEFORE, 'video.delete'), true, 'a video without a channel');
		assert.equal(await canOnVideo(env as never, { userId: BEFORE, channelId: BEFORE }, BEFORE, 'video.delete'), true);
		assert.equal(await canOnVideo(env as never, { userId: BEFORE, channelId: 'broken' }, BEFORE, 'video.delete'), false);
	});

	it('a video is deleted for good by the owner of today only', async () => {
		const { call } = await setup(true);
		assert.equal((await call(BEFORE, 'DELETE', '/api/videos/v1/permanent')).status, 403);
	});

	for (const indexed of [true, false]) {
		it(`private streams are listed for the owner of today (${indexed ? 'index' : 'scan'})`, async () => {
			const { call } = await setup(indexed);
			const ids = async (who: string, path: string) => (await call(who, 'GET', path)).body.result.data.map((s: { id: string }) => s.id).sort();
			assert.deepEqual(await ids(BEFORE, '/api/live-streams'), ['s-own']);
			assert.deepEqual(await ids(NOW, '/api/live-streams'), ['s1']);
			assert.deepEqual(await ids(NOW, '/api/live-streams?channelId=ch1'), ['s1']);
			assert.deepEqual(await ids(BEFORE, '/api/live-streams?channelId=ch1'), []);
		});
	}

	it('a scheduled post shows to those who manage the channel\'s posts', async () => {
		const { call } = await setup(false);
		for (const [who, shown] of [[BEFORE, false], [NOW, true], [EDITOR, true]] as const) {
			assert.equal((await call(who, 'GET', '/api/community/channels/ch1/posts/p1')).status, shown ? 200 : 404, who);
			assert.equal(((await call(who, 'GET', '/api/community/channels/ch1/posts')).body.posts ?? []).length, shown ? 1 : 0, who);
		}
	});

	it('a comment written as the channel can no longer be changed by the account that wrote it', async () => {
		const { b, call } = await setup(false);
		assert.equal((await call(BEFORE, 'PUT', '/api/videos/v1/comments/c-before', { text: 'changed' })).status, 403);
		assert.equal((await call(BEFORE, 'PUT', '/api/videos/v1/comments/c-self', { text: 'changed' })).status, 200);
		assert.equal((await call(BEFORE, 'PUT', '/api/videos/v1/comments/c-viewer', { text: 'changed' })).status, 200);
		assert.equal((await call(BEFORE, 'PUT', '/api/community/channels/ch1/posts/px/comments/pc1', { content: 'changed' })).status, 403);
		assert.equal(b.community_posts.read('comments/px/top-level/pc1.json').content, 'as the channel');
		assert.equal((await call(BEFORE, 'PUT', '/api/videos/v1/comments/c-gone', { text: 'changed' })).status, 403, 'a channel that is gone speaks for nobody');
	});

	it('nor deleted by it, with its replies; the owner of today removes it like anyone\'s', async () => {
		const { b, call } = await setup(false);
		b.community_posts.store.set('posts/ch1/px.json', JSON.stringify({ id: 'px', channelId: 'ch1', userId: NOW, type: 'text', content: 'p', status: 'published', createdAt: '2026-01-01T00:00:00.000Z' }));
		for (const path of ['/api/videos/v1/comments/c-before', '/api/community/channels/ch1/posts/px/comments/pc1']) assert.equal((await call(BEFORE, 'DELETE', path)).status, 403, path);
		const stored = b.videos.read('v1').comments;
		assert.equal(stored.find((c: { id: string }) => c.id === 'c-before').replies.length, 1);
		assert.equal(b.community_posts.read('comments/px/top-level/pc1.json').deletedAt, undefined);
		for (const cid of ['c-self', 'c-viewer']) assert.equal((await call(BEFORE, 'DELETE', `/api/videos/v1/comments/${cid}`)).status, 200, 'their own words still');
		assert.equal((await call(NOW, 'DELETE', '/api/videos/v1/comments/c-before')).status, 200);
		const after = b.videos.read('v1').comments.find((c: { id: string }) => c.id === 'c-before');
		assert.deepEqual([after.isDeleted, after.removedBy], [true, 'channel'], 'a removal the channel can restore');
	});

	it('is the author\'s to delete once the channel is gone, if it never was anyone else\'s; editing stays closed', async () => {
		const gone = (over: Record<string, unknown> = {}) => videoFixture({ id: 'v1', userId: NOW, channelId: 'ch1', comments: [commentFixture('c', { userId: BEFORE, channelId: 'gone', replies: [commentFixture('r', { userId: 'usr_x', channelId: null })], ...over })] });
		const post = (channelId: string) => JSON.stringify({ id: 'pc1', postId: 'px', userId: BEFORE, channelId, content: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
		const px = JSON.stringify({ id: 'px', channelId: 'ch1', userId: NOW, type: 'text', content: 'p', status: 'published', createdAt: '2026-01-01T00:00:00.000Z' });
		const job = (status: string, kind = 'channel.transfer', result: unknown = null) => ({ status, kind, result });
		const move = (status: string, result?: unknown) => job(status, 'channel.transfer', result);
		const cases: Array<[string, string, Array<{ status: string; kind: string; result: unknown }>, boolean]> = [
			['gone, never moved', 'gone', [], true],
			['gone, moves known not to have changed hands', 'gone', [move('failed', { changedHands: false }), move('succeeded', { skipped: 'stopped', changedHands: false }), move('succeeded', { skipped: 'channel_deleted', changedHands: false })], true],
			['gone, a failed move that may have changed hands', 'gone', [move('failed')], false],
			['gone, a failed move that did', 'gone', [move('failed', { changedHands: true })], false],
			['gone, a cancelled move', 'gone', [move('cancelled')], false],
			['gone, a move that found it deleted', 'gone', [move('succeeded', { skipped: 'channel_deleted' })], false],
			['gone, a move that found it gone', 'gone', [move('succeeded', { skipped: 'channel_not_found', changedHands: null })], false],
			['gone, one move of several did', 'gone', [move('failed', { changedHands: false }), move('succeeded', { videos: 1 })], false],
			['gone, other jobs', 'gone', [job('succeeded', 'channel.purge')], true],
			['gone after it moved to another account', 'gone', [job('failed'), job('succeeded')], false],
			['another account\'s now', 'ch1', [], false],
			['unreadable', 'broken', [], false],
			['their own', 'own', [], true],
		];
		for (const [name, channelId, jobs, allowed] of cases) {
			const { b, env, call } = await setup(true);
			jobs.forEach((j, i) => (env as any).SEARCH_DB.db.prepare("INSERT INTO admin_jobs (id, kind, target_kind, target_id, status, result, actor_id, created_at, updated_at) VALUES (?, ?, 'channel', ?, ?, ?, 'a', 't', 't')").run(`j${i}`, j.kind, channelId, j.status, j.result ? JSON.stringify(j.result) : null));
			b.videos.store.set('v1', JSON.stringify(gone({ channelId })));
			b.community_posts.store.set('posts/ch1/px.json', px);
			b.community_posts.store.set('comments/px/top-level/pc1.json', post(channelId));
			if (channelId !== 'own') {
				assert.equal((await call(BEFORE, 'PUT', '/api/videos/v1/comments/c', { text: 'changed' })).status, 403, `${name}: edit`);
				assert.equal((await call(BEFORE, 'PUT', '/api/community/channels/ch1/posts/px/comments/pc1', { content: 'changed' })).status, 403, `${name}: edit post comment`);
			}
			assert.equal((await call(BEFORE, 'DELETE', '/api/videos/v1/comments/c')).status, allowed ? 200 : 403, name);
			assert.equal((await call(BEFORE, 'DELETE', '/api/community/channels/ch1/posts/px/comments/pc1')).status, allowed ? 200 : 403, `${name}: post comment`);
			assert.equal(b.videos.read('v1').comments.length, allowed ? 0 : 1, name);
			assert.equal(!!b.community_posts.read('comments/px/top-level/pc1.json')?.deletedAt, allowed, name);
			// Someone else's comment never
			assert.equal((await call('usr_x', 'DELETE', '/api/videos/v1/comments/c')).status, allowed ? 404 : 403, `${name}: a stranger`);
		}
	});

	it('a moderator who wrote as a channel they left removes it as a moderator, not for good', async () => {
		const { b, call } = await setup(false);
		b.channels.store.set('mod', JSON.stringify({ id: 'mod', userId: BEFORE }));
		b.videos.store.set('v2', JSON.stringify(videoFixture({ id: 'v2', userId: BEFORE, channelId: 'mod', comments: [commentFixture('c-left', { userId: BEFORE, channelId: 'ch1' })] })));
		assert.equal((await call(BEFORE, 'DELETE', '/api/videos/v2/comments/c-left')).status, 200);
		assert.equal(b.videos.read('v2').comments[0].removedBy, 'channel');
	});

	it('speaks as a channel only with a role on it that is there', async () => {
		const { env } = await setup(false);
		const speaks = (channelId: string | null, who: string) => maySpeakAs(env as never, channelId, who);
		assert.equal(await speaks(null, BEFORE), true);
		assert.equal(await speaks(BEFORE, BEFORE), true);
		assert.equal(await speaks('ch1', NOW), true);
		assert.equal(await speaks('ch1', EDITOR), true);
		for (const channelId of ['ch1', 'gone', 'broken']) assert.equal(await speaks(channelId, BEFORE), false, channelId);
		assert.equal(await maySpeakAs({}, 'ch1', NOW), false, 'no store');
	});
});

describe('private videos inside playlists', () => {
	/** A public playlist of the moved channel whose first video is private and still names the owner before. */
	async function withPrivate() {
		const t = await setup(false);
		t.b.videos.store.set('v-private', JSON.stringify(videoFixture({ id: 'v-private', userId: BEFORE, channelId: 'ch1', isPublic: false, thumbnailUrl: 'https://images.test/private.jpg' })));
		t.b.videos.store.set('v-public', JSON.stringify(videoFixture({ id: 'v-public', userId: BEFORE, channelId: 'ch1', thumbnailUrl: 'https://images.test/public.jpg' })));
		t.b.playlists.store.set('pl-mixed', JSON.stringify({ id: 'pl-mixed', title: 'x', userId: BEFORE, channelId: 'ch1', videos: ['v-private', 'v-public'], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' }));
		return t;
	}

	it('show to the owner and team of today, not to the owner before: page, queue, cover, adding', async () => {
		const { b, env, call } = await withPrivate();
		for (const [who, sees] of [[BEFORE, false], [NOW, true], [EDITOR, true], [null, false]] as const) {
			const expected = sees ? ['v-private', 'v-public'] : ['v-public'];
			const page = (await call(who, 'GET', '/api/playlists/pl-mixed?includeVideos=true')).body;
			assert.deepEqual((page.videoItems ?? page.result?.videoItems ?? []).map((v: { id: string }) => v.id), expected, `page ${who}`);
			const queue = (await call(who, 'GET', '/api/playlists/pl-mixed/queue')).body;
			assert.deepEqual((queue.items ?? queue.result?.items ?? []).map((v: { id: string }) => v.id), expected, `queue ${who}`);
			const index = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: 'v-public', payload: JSON.stringify({ thumbnailUrl: 'https://images.test/public.jpg' }) }] }) }) }) };
			const cover = (await resolvePlaylistCovers({ ...env, SEARCH_DB: index } as never, [b.playlists.read('pl-mixed')], who)).get('pl-mixed');
			assert.equal(cover?.videoId, expected[0], `cover ${who}`);
		}
		for (const [who, status] of [[BEFORE, 404], [NOW, 200]] as const) {
			b.playlists.store.set('pl-mine', JSON.stringify({ id: 'pl-mine', title: 'x', userId: who, channelId: '', videos: [], isPublic: false }));
			assert.equal((await call(who, 'POST', '/api/playlists/pl-mine/videos', { videoId: 'v-private' })).status, status, `add ${who}`);
		}
	});

	it('read each channel once per request', async () => {
		const { b } = await withPrivate();
		let reads = 0;
		const get = b.channels.get.bind(b.channels);
		b.channels.get = (async (key: string) => {
			reads++;
			return get(key);
		}) as never;
		const memo = memoChannels({ channels: b.channels as never });
		await Promise.all(Array.from({ length: 20 }, () => ownsRecord(memo, { channelId: 'ch1', userId: BEFORE }, NOW)));
		assert.equal(reads, 1);
	});
});

describe('what hangs on a private video follows its channel of now, a move finished or not', () => {
	/** A private video of the moved channel that still names the owner before. */
	async function open(indexed = false) {
		const t = await setup(indexed);
		const video = videoFixture({
			id: 'vp', title: 'private lesson', userId: BEFORE, channelId: 'ch1', isPublic: false, duration: 100, uploadStatus: 'ready',
			scheduledPublishStatus: 'scheduled', scheduledPublishDate: '2999-01-01T00:00:00.000Z',
			commentSettings: 'held',
			comments: [commentFixture('c1', { userId: NOW, channelId: null, text: 'hello', replies: [commentFixture('r1', { userId: NOW, channelId: null })] })],
		});
		t.b.videos.store.set('vp', JSON.stringify(video));
		for (const id of ['s1', 's-own']) t.b.videos.store.delete(`livestream:${id}`);
		t.b.videos.store.set('vo', JSON.stringify(videoFixture({ id: 'vo', title: 'private own', userId: BEFORE, channelId: 'own', isPublic: false, uploadStatus: 'ready' })));
		if (indexed) await runOwnershipPass(t.env as never, 'video', { maxPages: 10, restart: true } as never);
		const env = { ...t.env, watch_history: new MemoryBucket(), global_settings: new MemoryBucket() } as Record<string, any>;
		const call = async (userId: string | null, method: string, path: string, body?: unknown) => {
			const app = buildApp((r: any) => {
				r.get('/api/videos', VideosList);
				r.get('/api/videos/search', VideoSearch);
				r.get('/api/videos/scheduled', VideoScheduleList);
				r.get('/api/videos/:id/comments', CommentList);
				r.get('/api/videos/:id/comments/:cid/replies', CommentRepliesList);
				r.post('/api/videos/:id/comments', CommentCreate);
				r.put('/api/videos/:id/comments/:cid', CommentUpdate);
				r.post('/api/videos/:id/comments/:cid/likes', CommentLikeCreate);
				r.post('/api/videos/:id/view', VideoView);
				r.post('/api/videos/:id/watch-time', VideoWatchTime);
				r.post('/api/videos/:id/retention', VideoRetention);
				r.post('/api/videos/upload/failed/:videoId', UploadFailedEndpoint);
			}, userId ? { userId } : null);
			const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
			const text = await res.text();
			let json: any = null;
			try { json = JSON.parse(text); } catch { json = text; }
			return { status: res.status, body: json };
		};
		return { ...t, env, call };
	}

	const READS: Array<[string, string, unknown, number]> = [
		['GET', '/api/videos/vp/comments', undefined, 200],
		['GET', '/api/videos/vp/comments/c1/replies', undefined, 200],
		['POST', '/api/videos/vp/comments', { text: 'a comment' }, 200],
		['POST', '/api/videos/vp/comments/c1/likes', {}, 200],
		['POST', '/api/videos/vp/view', {}, 200],
		['POST', '/api/videos/vp/watch-time', { seconds: 5, sessionId: 'session-1' }, 202],
		['POST', '/api/videos/vp/retention', { buckets: [0], sessionId: 'session-1' }, 202],
	];
	for (const [method, path, body, ok] of READS) {
		it(`${method} ${path}`, async () => {
			for (const [who, status] of [[BEFORE, 404], ['usr_x', 404], [NOW, ok], [EDITOR, ok]] as const) {
				const { call } = await open();
				assert.equal((await call(who, method, path, body)).status, status, who);
			}
		});
	}

	it('the owner of today\'s comment is never held, the owner before\'s is, and the owner of today is told', async () => {
		const { b, env, call } = await open();
		b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), isPublic: true, scheduledPublishStatus: undefined, scheduledPublishDate: undefined }));
		assert.equal((await call(NOW, 'POST', '/api/videos/vp/comments', { text: 'mine' })).status, 200);
		assert.equal((await call(BEFORE, 'POST', '/api/videos/vp/comments', { text: 'theirs' })).status, 200);
		const stored = b.videos.read('vp').comments.filter((c: any) => c.id !== 'c1');
		assert.deepEqual(stored.map((c: any) => [c.userId, c.status ?? 'shown']), [[NOW, 'shown'], [BEFORE, 'held']]);
		assert.ok(env);
	});

	it('a video that changes channel under a comment is judged by the one it is on', async () => {
		const { b, call } = await open();
		const get = b.videos.get.bind(b.videos);
		let reads = 0;
		(b.videos as any).get = async (key: string) => {
			// After the first look the video is on a channel of the owner before
			if (key === 'vp' && ++reads === 2) b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), channelId: 'own' }));
			return get(key);
		};
		assert.equal((await call(NOW, 'POST', '/api/videos/vp/comments', { text: 'x' })).status, 404);
		assert.equal(b.videos.read('vp').comments.length, 1);
	});

	for (const indexed of [true, false]) {
		it(`lists and search (${indexed ? 'index' : 'scan'})`, async () => {
			const { call } = await open(indexed);
			const ids = (r: any) => (r.body.data ?? r.body.result?.data ?? r.body.results ?? []).map((v: any) => v.id).sort();
			assert.deepEqual(ids(await call(BEFORE, 'GET', '/api/videos?limit=50')), ['v1', 'vo']);
			assert.deepEqual(ids(await call(BEFORE, 'GET', '/api/videos?limit=50&channelId=ch1')), ['v1']);
			assert.deepEqual(ids(await call(NOW, 'GET', '/api/videos?limit=50&channelId=ch1')), ['v1', 'vp']);
			assert.deepEqual(ids(await call(null, 'GET', '/api/videos?limit=50&channelId=ch1')), ['v1']);
			const search = async (who: string | null, q: string) => {
				const r = await call(who, 'GET', `/api/videos/search?limit=50&${q}`);
				assert.equal(r.status, 200, JSON.stringify(r.body));
				return (JSON.stringify(r.body).match(/"id":"(v1|vp|vo)"/g) ?? []).map((m) => m.slice(6, 8)).sort();
			};
			assert.deepEqual(await search(BEFORE, 'isOwner=true'), ['vo'], 'not what is on the moved channel, public or not');
			assert.deepEqual(await search(NOW, 'isOwner=true&channelIds=ch1'), ['v1', 'vp']);
			assert.deepEqual(await search(BEFORE, 'channelIds=ch1'), ['v1']);
		});

		it(`scheduled videos (${indexed ? 'index' : 'scan'})`, async () => {
			const { call } = await open(indexed);
			const scheduled = await call(BEFORE, 'GET', '/api/videos/scheduled');
			assert.equal(scheduled.status, 200);
			assert.ok(!JSON.stringify(scheduled.body).includes('"vp"'));
		});
	}

	it('the index finds the new owner\'s videos by the channel, and spends nothing on the old owner\'s moved ones', async () => {
		const { env, call, b } = await open(true);
		// Many moved videos, all newer than the old owner's own; their rows still name the old owner
		for (let i = 0; i < 520; i++) b.videos.store.set(`m${i}`, JSON.stringify(videoFixture({ id: `m${i}`, title: 'moved', userId: BEFORE, channelId: 'ch1', isPublic: false, uploadStatus: 'ready', dateCreated: '2026-06-01T00:00:00.000Z' })));
		b.videos.store.set('gone', JSON.stringify(videoFixture({ id: 'gone', title: 'on a channel that is gone', userId: BEFORE, channelId: 'gone', isPublic: false, uploadStatus: 'ready', dateCreated: '2026-01-01T00:00:00.000Z' })));
		await runOwnershipPass(env as never, 'video', { maxPages: 50, restart: true } as never);
		const db = (env as any).SEARCH_DB;
		assert.equal(db.db.prepare(`SELECT owner_id FROM content_ownership WHERE kind = 'video' AND id = 'vp'`).get().owner_id, BEFORE, 'the row has not caught up');
		const found = async (who: string) => new Set<string>((JSON.stringify((await call(who, 'GET', '/api/videos/search?isOwner=true&limit=50')).body).match(/"id":"[a-z0-9-]+"/g) ?? []).map((m) => m.slice(6, -1)));
		const before = await found(BEFORE);
		assert.ok(before.has('vo') && before.has('gone'), 'their own, though 520 newer rows still name them');
		assert.ok(![...before].some((id) => /^m\d|^v[1p]$/.test(id)));
		assert.ok([...(await found(NOW))].some((id) => /^m\d/.test(id)));
		assert.deepEqual((await ownVideoIds(env as never, NOW, { newest: 1000 }))!.length, 522, 'v1, vp and the moved ones');
		assert.deepEqual((await ownVideoIds(env as never, BEFORE))!, ['gone', 'vo']);
		const scheduled = async (who: string) => JSON.stringify((await call(who, 'GET', '/api/videos/scheduled')).body).includes('"vp"');
		assert.deepEqual([await scheduled(NOW), await scheduled(BEFORE)], [true, false]);
		const list = async (who: string) => new Set<string>((await call(who, 'GET', '/api/videos?limit=50&filter=private')).body.data.map((v: any) => v.id));
		assert.ok([...(await list(NOW))].some((id) => /^m\d|^vp$/.test(id)), 'the general list too');
		const own = await list(BEFORE);
		assert.deepEqual([...own].sort(), ['gone', 'vo'], 'not buried under rows that are no longer theirs');
		// Every statement by an index
		db.trace = [];
		await ownVideoIds(env as never, NOW, { newest: 500 });
		await ownVideoIds(env as never, NOW, { scheduled: true, channelId: 'ch1', scheduleStatus: 'scheduled' });
		const statements = (db.trace as Array<{ sql?: string } | string>).map((s) => (typeof s === 'string' ? s : (s.sql ?? ''))).filter((text) => /channel_id IN/.test(text));
		assert.equal(statements.length, 2);
		for (const text of statements) {
			const plan = (db.db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...Array((text.match(/\?/g) ?? []).length).fill('x')) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
			assert.match(plan, /SEARCH content_ownership USING (COVERING )?INDEX idx_content_ownership_channel/, plan);
			assert.doesNotMatch(plan, /SCAN content_ownership|SCAN c\b/, plan);
		}
	});

	it('while the channel index is rebuilt the lists read the rows there are, and say so', async () => {
		const { env } = await open(true);
		(env as any).SEARCH_DB.db.prepare(`DELETE FROM search_meta WHERE key = ?`).run(ownershipCompleteKey('channel'));
		assert.equal(await ownVideoIds(env as never, NOW), null);
		const mine = { sort: 'latest' as const, limit: 10, privateFor: NOW };
		for (const channelId of [null, 'ch1']) {
			assert.equal((await channelVideoIds(env as never, channelId, mine))!.incomplete, true);
			assert.equal((await channelVideoIds(env as never, channelId, { ...mine, privateFor: null }))!.incomplete, undefined, 'public lists do not need it');
		}
		assert.equal((await videoListIds(env as never, 'ch1', mine))!.incomplete, true);
		assert.equal((await videoListIds(env as never, 'ch1', { ...mine, privateFor: null }))!.incomplete, undefined);
	});

	it('a list on an incomplete index, or a search that scans, asks for the channel index too', async () => {
		for (const path of ['/api/videos?limit=50', '/api/videos/search?isOwner=true']) {
			const { env, call } = await open(true);
			env.ADMIN_JOBS_QUEUE = new MemoryQueue();
			const db = env.SEARCH_DB.db;
			db.prepare(`DELETE FROM search_meta WHERE key = ?`).run(ownershipCompleteKey('channel'));
			const r = await call(NOW, 'GET', path);
			assert.equal(r.status, 200);
			assert.ok(JSON.stringify(r.body).includes('"id":"vp"'), path);
			for (let i = 0; i < 50 && !db.prepare("SELECT 1 FROM search_meta WHERE key = 'ownership:heal-queued:channel'").get(); i++) await new Promise((done) => setTimeout(done, 5));
			assert.ok(db.prepare("SELECT 1 FROM search_meta WHERE key = 'ownership:heal-queued:channel'").get(), path);
		}
	});

	it('the general list reads public rows in order and the caller\'s own apart', async () => {
		const { env, b } = await open(true);
		const put = (id: string, over: Record<string, unknown>) => b.videos.store.set(id, JSON.stringify(videoFixture({ id, title: id, userId: NOW, channelId: 'ch1', uploadStatus: 'ready', ...over })));
		for (let i = 0; i < 6; i++) put(`p${i}`, { userId: 'usr_x', channelId: 'other', isPublic: true, views: i, dateCreated: `2026-05-0${i + 1}T00:00:00.000Z` });
		put('own-old', { isPublic: false, views: 100, dateCreated: '2026-05-03T12:00:00.000Z' });
		put('own-busy', { isPublic: true, uploadStatus: 'processing', views: 1, dateCreated: '2026-05-05T12:00:00.000Z' });
		put('theirs', { userId: 'usr_x', channelId: 'other', isPublic: false, dateCreated: '2026-05-06T12:00:00.000Z' });
		put('lone', { channelId: null, isPublic: false, dateCreated: '2026-05-04T12:00:00.000Z' });
		await runOwnershipPass(env as never, 'video', { maxPages: 50, restart: true } as never);
		const may = (ids: string[]) => ids.filter((id) => /^(p\d|own-|theirs|lone)/.test(id));
		const list = async (over = {}) => (await channelVideoIds(env as never, null, { sort: 'latest', limit: 50, privateFor: NOW, ...over }))!;
		assert.deepEqual(may((await list()).ids), ['p5', 'own-busy', 'p4', 'lone', 'p3', 'own-old', 'p2', 'p1', 'p0']);
		assert.deepEqual(may((await list({ sort: 'oldest' })).ids), ['p0', 'p1', 'p2', 'own-old', 'p3', 'lone', 'p4', 'own-busy', 'p5']);
		assert.equal(may((await list({ sort: 'popular' })).ids)[0], 'own-old');
		assert.deepEqual(may((await list({ isPublic: false })).ids), ['lone', 'own-old']);
		assert.deepEqual(may((await list({ privateFor: 'usr_none' })).ids), ['p5', 'p4', 'p3', 'p2', 'p1', 'p0']);
		const whole = (await list()).ids;
		const pages: string[] = [];
		for (let offset = 0; ; offset += 2) {
			const page = await list({ limit: 2, offset });
			pages.push(...page.ids);
			if (!page.hasMore) break;
		}
		assert.deepEqual(pages, whole, 'every page, nothing twice or left out');
		// Plans: public rows by (kind, created_at) without reading the rest, own rows by their channels and by owner
		const db = env.SEARCH_DB;
		const plans = async (read: () => Promise<unknown>) => {
			db.trace = [];
			await read();
			return (db.trace as Array<{ sql?: string } | string>).map((s) => (typeof s === 'string' ? s : (s.sql ?? ''))).filter((text) => /FROM content_ownership WHERE|FROM \(SELECT/.test(text) && /privateFor|is_hidden/.test(text))
				.map((text) => (db.db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...Array((text.match(/\?/g) ?? []).length).fill(1)) as Array<{ detail: string }>).map((r) => r.detail));
		};
		for (const sort of ['latest', 'oldest'] as const) {
			const [plan] = await plans(() => list({ sort }));
			const text = plan.join(' | ');
			assert.match(text, /content_ownership USING INDEX idx_content_ownership_created \(kind=\?\)/, text);
			assert.match(text, /content_ownership USING INDEX idx_content_ownership_channel\w* \(kind=\? AND channel_id=\?/, text);
			assert.match(text, /content_ownership USING INDEX idx_content_ownership_owner \(kind=\? AND owner_id=\?\)/, text);
			assert.equal(plan.filter((line) => /CORRELATED/.test(line)).length, 1, `only the caller's own rows: ${text}`);
			assert.doesNotMatch(text, /SCAN content_ownership|SCAN c\b|AUTOMATIC/, text);
			assert.equal((text.match(/idx_content_ownership_created/g) ?? []).length, 1);
		}
		const [own] = await plans(() => list({ isPublic: false }));
		assert.doesNotMatch(own.join(' | '), /idx_content_ownership_(kind_)?created/, own.join(' | '));
		for (const read of [() => channelVideoIds(env as never, 'ch1', { sort: 'latest', limit: 5, privateFor: NOW }), () => videoListIds(env as never, 'ch1', { sort: 'latest', limit: 5, privateFor: NOW })]) {
			const [plan] = await plans(read);
			const text = plan.join(' | ');
			assert.match(text, /SEARCH content_ownership USING INDEX idx_content_ownership_channel/, text);
			assert.doesNotMatch(text, /CORRELATED|SCAN content_ownership/, text);
		}
	});

	it('an upload is reported failed by the owner of today, or its uploader while they may upload', async () => {
		for (const [who, status] of [[BEFORE, 403], [NOW, 200], [EDITOR, 403]] as const) {
			const { b, call } = await open();
			b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), uploadStatus: 'uploading' }));
			assert.equal((await call(who, 'POST', '/api/videos/upload/failed/vp', {})).status, status, who);
		}
		const { b, call } = await open();
		b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), uploadStatus: 'uploading', channelId: 'broken' }));
		assert.equal((await call(NOW, 'POST', '/api/videos/upload/failed/vp', {})).status, 503, 'a channel that cannot be read: try again');
	});

	it('watch history shows a private video\'s title of now only to who may open it', async () => {
		const { env } = await open();
		const entries = [{ videoId: 'vp', videoTitle: 'as it was' }];
		for (const [who, title] of [[BEFORE, 'as it was'], [NOW, 'private lesson']] as const) assert.equal((await withLiveVideoFields(env as never, who, entries))[0].videoTitle, title, who);
	});

	it('a comment on a closed video can no longer be edited by the account it named', async () => {
		const { b, call } = await open();
		b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), comments: [commentFixture('mine', { userId: BEFORE, channelId: null, text: 'mine' }), commentFixture('now', { userId: NOW, channelId: null, text: 'now' })] }));
		assert.equal((await call(BEFORE, 'PUT', '/api/videos/vp/comments/mine', { text: 'changed' })).status, 404);
		assert.equal((await call(NOW, 'PUT', '/api/videos/vp/comments/now', { text: 'changed' })).status, 200);
	});

	it('a comment or a like on a video that moves meanwhile is judged by where it lands', async () => {
		const meanwhile = (b: any, when: number, channelId: string) => {
			const get = b.videos.get.bind(b.videos);
			let reads = 0;
			b.videos.get = async (key: string) => {
				if (key === 'vp' && ++reads === when) b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), channelId }));
				return get(key);
			};
		};
		// From a channel the commenter has nothing on to theirs: written
		const into = await open();
		into.b.videos.store.set('vp', JSON.stringify({ ...into.b.videos.read('vp'), channelId: 'own' }));
		meanwhile(into.b, 2, 'ch1');
		assert.equal((await into.call(NOW, 'POST', '/api/videos/vp/comments', { text: 'x' })).status, 200);
		// Between the check and the write, to a channel they have nothing on: not
		const away = await open();
		meanwhile(away.b, 2, 'own');
		assert.equal((await away.call(NOW, 'POST', '/api/videos/vp/comments/c1/likes', {})).status, 404);
		assert.deepEqual(away.b.videos.read('vp').comments[0].likes ?? [], []);
	});

	it('the owner of today hears of a comment', async () => {
		const { b, env, call } = await open();
		b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), isPublic: true, commentSettings: 'on', scheduledPublishStatus: undefined, scheduledPublishDate: undefined }));
		Object.assign(env, { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' });
		const told: string[] = [];
		const real = globalThis.fetch;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			told.push(`${url} ${String(init?.body ?? '')}`);
			return Response.json({ success: true });
		}) as typeof fetch;
		try {
			assert.equal((await call('usr_x', 'POST', '/api/videos/vp/comments', { text: 'hello' })).status, 200);
			await new Promise((resolve) => setTimeout(resolve, 20));
		} finally {
			globalThis.fetch = real;
		}
		const all = told.filter((t) => t.includes('newComment') || t.includes('user:')).join('\n');
		assert.ok(all.includes(NOW), all);
		assert.ok(!all.includes(BEFORE), all);
	});

	it('watch state, continue watching and liked videos keep a private video to who may open it', async () => {
		const { env } = await open();
		env.NOTIFICATIONS_DB = createSqliteD1();
		env.global_settings = new MemoryBucket();
		for (const who of [BEFORE, NOW]) await env.NOTIFICATIONS_DB.prepare('INSERT INTO liked_videos (user_id, video_id, liked_at) VALUES (?, ?, 1)').bind(who, 'vp').run();
		const app = (who: string) => buildApp((r: any) => {
			r.put('/api/watch-state/:videoId', WatchStatePut);
			r.get('/api/continue-watching', ContinueWatchingList);
			r.get('/api/library/liked', LikedVideosList);
		}, { userId: who });
		for (const [who, shown] of [[BEFORE, false], [NOW, true]] as const) {
			const put = await app(who).request('/api/watch-state/vp', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position: 30, duration: 100, clientUpdatedAt: new Date().toISOString() }) }, env as never);
			assert.equal(put.status, shown ? 200 : 404, `${who}: ${await put.clone().text()}`);
			env.watch_history.store.set(`${who}:vp`, JSON.stringify({ id: `${who}:vp`, userId: who, videoId: 'vp', videoTitle: 'x', videoDuration: 100, progress: 30, completed: false, percentageWatched: 30, firstWatchedAt: '2026-11-01T00:00:00.000Z', lastWatchedAt: new Date().toISOString() }));
			const text = async (path: string) => (await app(who).request(path, {}, env as never)).text();
			assert.equal((await text('/api/continue-watching?limit=10')).includes('"vp"'), shown, `${who} continue`);
			assert.equal((await text('/api/library/liked?limit=10')).includes('"vp"'), shown, `${who} liked`);
		}
	});

	it('an AI category suggestion is the owner of today\'s to read', async () => {
		const { env } = await open(true);
		await markCategorySuggestionPending((env as any).SEARCH_DB, { subjectId: 'vp', subjectType: 'video', reason: 'upload', now: Date.now() });
		for (const [who, status] of [[BEFORE, 404], [NOW, 200]] as const) {
			const res = await buildApp((r: any) => r.get('/api/videos/category-suggestions', CategorySuggestionGet), { userId: who }).request('/api/videos/category-suggestions?videoId=vp', {}, env as never);
			assert.equal(res.status, status, who);
		}
	});

	it('a member acting as the channel lists its private videos, one without that role does not', async () => {
		for (const indexed of [true, false]) {
			const { env } = await open(indexed);
			const list = async (who: string, role: string) => {
				const app = buildApp((r: any) => {
					r.use('*', async (c: any, next: any) => {
						c.set('channelRole', role);
						c.set('channelOwnerId', NOW);
						await next();
					});
					r.get('/api/videos', VideosList);
				}, { userId: who });
				const res = await app.request('/api/videos?limit=50&channelId=ch1', { headers: { channelId: 'ch1' } }, env as never);
				return ((await res.json()) as any).data.map((v: any) => v.id).sort();
			};
			assert.deepEqual(await list(EDITOR, 'editor'), ['v1', 'vp'], `${indexed}`);
			assert.deepEqual(await list('usr_x', 'moderator'), can('moderator', 'video.view_private') ? ['v1', 'vp'] : ['v1'], `${indexed}`);
		}
	});

	it('the processing issue\'s reason goes to who may upload to the channel now', () => {
		const video = { userId: BEFORE, channelId: 'ch1', processingIssue: { kind: 'needs_reupload', reason: 'r' } };
		const channel = { userId: NOW, members: [{ userId: EDITOR, role: 'editor' as const }] };
		for (const [who, sees] of [[BEFORE, false], [NOW, true], [EDITOR, true]] as const) assert.equal(!!uploaderProcessingIssue(video, channel as never, who).processingIssue, sees, who);
		assert.deepEqual(uploaderProcessingIssue(video, null, BEFORE), {}, 'a channel that was not read');
		assert.ok(uploaderProcessingIssue({ ...video, channelId: null }, null, BEFORE).processingIssue, 'a video without one');
	});

	it('an uploader whose role no longer uploads cannot report a failure', async () => {
		const { b, call } = await open();
		b.channels.store.set('ch1', JSON.stringify({ ...b.channels.read('ch1'), members: [{ userId: EDITOR, role: 'moderator' }] }));
		b.videos.store.set('vp', JSON.stringify({ ...b.videos.read('vp'), uploadStatus: 'uploading', uploadedBy: EDITOR }));
		assert.equal((await call(EDITOR, 'POST', '/api/videos/upload/failed/vp', {})).status, 403);
	});

	it('live chat goes by the tier of the owner of today, channel by channel', async () => {
		const { env } = await open(true);
		const db = (env as any).SEARCH_DB;
		await saveTier(db, 'creator', { live: true }, 'test');
		db.db.prepare("INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 'creator', 'admin', 'test', '2026-11-01')").run(NOW);
		forgetChatTiers();
		const has = (channelId: string) => ownerTierHasChat(env as never, { id: channelId, channelId, ownerId: BEFORE } as ChatStream);
		assert.deepEqual([await has('ch1'), await has('own')], [true, false], 'both rows name the owner before');
	});

	it('analytics count what is on the channels, whoever the records name', async () => {
		const { env } = await open(true);
		const of = async (who: string, channel: string) => (await loadOwnedVideos(env.videos, who, new Set([channel]), undefined, { env } as never)).map((v) => v.id).sort();
		assert.deepEqual(await of(NOW, 'ch1'), ['v1', 'vp']);
		assert.deepEqual(await of(BEFORE, 'own'), ['vo']);
	});

	it('live chat answers to the channel of now', async () => {
		const { env } = await open(true);
		const stream = { id: 's1', channelId: 'ch1', ownerId: BEFORE } as ChatStream;
		assert.deepEqual(await chatRole(env as never, stream, BEFORE), { isOwner: false, moderates: false, manages: false });
		assert.deepEqual(await chatRole(env as never, stream, NOW), { isOwner: true, moderates: true, manages: true });
		assert.deepEqual(await chatRole(env as never, { ...stream, channelId: null }, BEFORE), { isOwner: true, moderates: true, manages: true });
		assert.deepEqual(await chatRole(env as never, { ...stream, channelId: 'broken' }, BEFORE), { isOwner: false, moderates: false, manages: false });
		forgetChatTiers();
		assert.equal(await ownerTierHasChat({ channels: env.channels, SEARCH_DB: env.SEARCH_DB } as never, { ...stream, channelId: 'broken' }), false);
	});

	it('whether a move took the channel', () => {
		const job = (status: string, result: unknown = null) => ({ status, params: { newOwnerId: NOW }, result: result as never });
		assert.equal(moveOutcome(job('succeeded')), 'moved');
		assert.equal(moveOutcome(job('failed')), 'unknown');
		assert.equal(moveOutcome(job('failed'), { userId: NOW }), 'moved');
		assert.equal(moveOutcome(job('failed'), { userId: BEFORE }), 'unknown');
		assert.equal(moveOutcome(job('succeeded', { skipped: 'stopped', changedHands: false })), 'not_moved');
		assert.equal(moveOutcome(job('succeeded', { skipped: 'stopped' })), 'unknown', 'only the field says it did not');
		for (const skipped of ['channel_deleted', 'channel_not_found']) assert.equal(moveOutcome(job('succeeded', { skipped })), 'unknown');
		assert.equal(moveOutcome(job('succeeded', { skipped: 'channel_deleted' }), { userId: NOW }), 'moved');
		for (const result of ['{', '"x"', 'null', '[]']) assert.notEqual(moveOutcomeOfRow({ status: 'failed', params: null, result }), 'not_moved', result);
		assert.equal(moveOutcomeOfRow({ status: 'succeeded', params: '{', result: null }), 'unknown', 'unreadable is never "did not"');
		for (const status of ['failed', 'succeeded', 'cancelled']) {
			assert.equal(moveOutcome(job(status, { changedHands: true })), 'moved');
			assert.equal(moveOutcome(job(status, { changedHands: false })), 'not_moved');
		}
	});
});
