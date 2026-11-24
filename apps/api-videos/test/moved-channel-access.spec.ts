/**
 * What is on a channel belongs to the channel's owner now (lib/channelAccess.ts): records that still
 * name an earlier owner give that account nothing, and the owner and members of today everything.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, commentFixture, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { runOwnershipPass } from '../src/lib/search/ownership';
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
		const job = (status: string, kind = 'channel.transfer') => ({ status, kind });
		const cases: Array<[string, string, Array<{ status: string; kind: string }>, boolean]> = [
			['gone, never moved', 'gone', [], true],
			['gone, a move that never finished', 'gone', [job('failed'), job('cancelled')], true],
			['gone, other jobs', 'gone', [job('succeeded', 'channel.purge')], true],
			['gone after it moved to another account', 'gone', [job('failed'), job('succeeded')], false],
			['another account\'s now', 'ch1', [], false],
			['unreadable', 'broken', [], false],
			['their own', 'own', [], true],
		];
		for (const [name, channelId, jobs, allowed] of cases) {
			const { b, env, call } = await setup(true);
			jobs.forEach((j, i) => (env as any).SEARCH_DB.db.prepare("INSERT INTO admin_jobs (id, kind, target_kind, target_id, status, actor_id, created_at, updated_at) VALUES (?, ?, 'channel', ?, ?, 'a', 't', 't')").run(`j${i}`, j.kind, channelId, j.status));
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
