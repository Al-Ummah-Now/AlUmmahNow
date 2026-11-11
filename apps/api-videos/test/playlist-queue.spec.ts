/**
 * Playback queue (GET /api/playlists/:id/queue, lib/playlistQueue.ts;
 * docs/specs/PLAYLIST-PLAYBACK.md section 3): the saved order after a
 * reorder, automatic sorts, Watch later and Liked aliases, windows around the
 * playing video, per-viewer visibility, and the 404 cases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { createSqliteD1 } from './sqlite-d1';
import { SqliteD1 } from './search-sqlite-d1';
import { PlaylistQueue } from '../src/endpoints/playlist/playlistQueue';
import { PlaylistVideosReorder } from '../src/endpoints/playlist/playlistBulk';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { FULL_SCAN_MAX, locate, positionAfter, queueWindow } from '../src/lib/playlistQueue';

const OWNER = 'owner';
const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${String(i).padStart(4, '0')}`);

function setup(opts: { videos?: number; playlists?: Record<string, unknown>; extraVideos?: Record<string, unknown>; liked?: Array<[string, string, number]> } = {}) {
	const videos: Record<string, unknown> = {};
	for (const [i, id] of ids(opts.videos ?? 10).entries()) {
		videos[id] = videoFixture({ id, title: `Lesson ${String.fromCharCode(97 + (i % 26))}${i}`, userId: OWNER, channelId: 'ch', views: i * 10, duration: 60 + i });
	}
	Object.assign(videos, opts.extraVideos ?? {});
	const db = createSqliteD1();
	for (const [user, video, at] of opts.liked ?? []) db.raw.prepare('INSERT INTO liked_videos VALUES (?, ?, ?)').run(user, video, at);
	return {
		SEARCH_DB: new SqliteD1(),
		NOTIFICATIONS_DB: db,
		playlists: new MemoryBucket(opts.playlists ?? {}),
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({ ch: { id: 'ch', name: 'Lessons channel', handle: 'lessons', userId: OWNER, members: [], dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' } }),
		queue: new MemoryQueue(),
	};
}

function playlist(id: string, overrides: Record<string, unknown> = {}) {
	return { id, userId: OWNER, channelId: 'ch', title: `Playlist ${id}`, videos: [], isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides };
}

const ROUTES = (r: any) => {
	r.post('/api/playlists', PlaylistCreate);
	r.get('/api/playlists/:id/queue', PlaylistQueue);
	r.put('/api/playlists/:id/videos/order', PlaylistVideosReorder);
};

async function call(env: unknown, userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
	const res = await buildApp(ROUTES, userId ? { userId } : null).request(path, {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}, env as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const queueIds = (res: { body: any }) => res.body.result.items.map((i: any) => i.id);

describe('queue window helpers', () => {
	const entries = ['a', 'b', 'c', 'b', 'd'].map((id, index) => ({ id, index }));

	it('locate: the occurrence nearest the URL index wins; none when absent', () => {
		assert.equal(locate(entries, 'b', undefined), 1);
		assert.equal(locate(entries, 'b', 4), 3);
		assert.equal(locate(entries, 'b', 0), 1);
		assert.equal(locate(entries, 'zz', 2), null);
	});

	it('positionAfter: the first visible item at or after a stored index', () => {
		const visible = [{ id: 'a', index: 0 }, { id: 'c', index: 2 }, { id: 'd', index: 5 }];
		assert.equal(positionAfter(visible, 3), 2);
		assert.equal(positionAfter(visible, 6), null);
		assert.equal(positionAfter(visible, undefined), null);
	});

	it('queueWindow: a window around the video, cursors both ways', () => {
		const many = ids(120).map((id, index) => ({ id, index }));
		const w = queueWindow(many, { video: 'v0080', limit: 20, exact: true });
		assert.equal(w.position, 80);
		assert.equal(w.offset, 70);
		assert.equal(w.entries.length, 20);
		assert.equal(w.prevOffset, 50);
		assert.equal(w.nextOffset, 90);
		const start = queueWindow(many, { limit: 20, exact: true });
		assert.equal(start.offset, 0);
		assert.equal(start.prevOffset, null);
		const last = queueWindow(many, { offset: 110, limit: 20, exact: true });
		assert.equal(last.entries.length, 10);
		assert.equal(last.nextOffset, null);
	});
});

describe('GET /api/playlists/:id/queue', () => {
	it('follows the saved manual order, and the new order after a reorder', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { videos: ['v0003', 'v0001', 'v0002', 'v0000'] }) } });
		const first = await call(env, null, 'GET', '/api/playlists/pl/queue');
		assert.equal(first.status, 200);
		assert.deepEqual(queueIds(first), ['v0003', 'v0001', 'v0002', 'v0000']);
		assert.deepEqual(first.body.result.items.map((i: any) => i.position), [0, 1, 2, 3]);
		assert.equal(first.body.result.playlist.title, 'Playlist pl');
		assert.equal(first.body.result.playlist.channelName, 'Lessons channel');
		assert.equal(first.body.result.playlist.channelHandle, 'lessons');
		assert.equal(first.body.result.items[0].channelName, 'Lessons channel');
		assert.equal(first.headers.get('cache-control'), 'private, no-cache');

		const reordered = await call(env, OWNER, 'PUT', '/api/playlists/pl/videos/order', { videoIds: ['v0000', 'v0002', 'v0003', 'v0001'] }, { channelId: 'ch' });
		assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
		const after = await call(env, null, 'GET', '/api/playlists/pl/queue?video=v0003');
		assert.deepEqual(queueIds(after), ['v0000', 'v0002', 'v0003', 'v0001']);
		assert.equal(after.body.result.position, 2);
	});

	it('follows an automatic sort (field and direction)', async () => {
		const env = setup();
		const created = await call(env, OWNER, 'POST', '/api/playlists', { title: 'Popular', sortMode: 'auto', sortField: 'views', sortDirection: 'desc', videos: ['v0001', 'v0004', 'v0002'] }, { channelId: 'ch' });
		assert.equal(created.status, 200, JSON.stringify(created.body));
		const id = created.body.result.playlist.id;
		const res = await call(env, null, 'GET', `/api/playlists/${id}/queue`);
		assert.deepEqual(queueIds(res), ['v0004', 'v0002', 'v0001']);
		assert.equal(res.body.result.playlist.sortMode, 'auto');
	});

	it('leaves out what the viewer may not see; positions and total count the rest', async () => {
		const env = setup({
			playlists: { pl: playlist('pl', { videos: ['v0001', 'priv', 'gone', 'v0002', 'missing', 'v0003'] }) },
			extraVideos: {
				priv: videoFixture({ id: 'priv', userId: OWNER, channelId: 'ch', isPublic: false }),
				gone: videoFixture({ id: 'gone', userId: OWNER, channelId: 'ch', isDeleted: true }),
			},
		});
		const anon = await call(env, null, 'GET', '/api/playlists/pl/queue?video=v0002&index=3');
		assert.deepEqual(queueIds(anon), ['v0001', 'v0002', 'v0003']);
		assert.equal(anon.body.result.total, 3);
		assert.equal(anon.body.result.position, 1);
		assert.deepEqual(anon.body.result.items.map((i: any) => i.index), [0, 3, 5], 'stored index stays the URL index');
		const owner = await call(env, OWNER, 'GET', '/api/playlists/pl/queue');
		assert.deepEqual(queueIds(owner), ['v0001', 'priv', 'v0002', 'v0003']);
	});

	it('a video that left the list: no position, and the next item from the URL index', async () => {
		const env = setup({ playlists: { pl: playlist('pl', { videos: ['v0001', 'v0002', 'v0003'] }) } });
		const res = await call(env, null, 'GET', '/api/playlists/pl/queue?video=v0009&index=1');
		assert.equal(res.body.result.position, null);
		assert.equal(res.body.result.nextPosition, 1);
	});

	it('pages a long list around the playing video', async () => {
		const env = setup({ videos: 120, playlists: { pl: playlist('pl', { videos: ids(120) }) } });
		const res = await call(env, null, 'GET', '/api/playlists/pl/queue?video=v0100&limit=10');
		assert.equal(res.body.result.total, 120);
		assert.equal(res.body.result.position, 100);
		assert.equal(res.body.result.offset, 95);
		assert.deepEqual(queueIds(res), ids(120).slice(95, 105));
		const next = await call(env, null, 'GET', `/api/playlists/pl/queue?offset=${res.body.result.nextOffset}&limit=10`);
		assert.deepEqual(queueIds(next), ids(120).slice(105, 115));
	});

	it(`lists longer than ${FULL_SCAN_MAX} are paged over the stored ids (exact: false)`, async () => {
		const n = FULL_SCAN_MAX + 5;
		const env = setup({ videos: n, playlists: { pl: playlist('pl', { videos: ids(n) }) } });
		const reads = env.videos.calls;
		const res = await call(env, null, 'GET', `/api/playlists/pl/queue?video=${ids(n)[n - 1]}&limit=4`);
		assert.equal(res.body.result.exact, false);
		assert.equal(res.body.result.position, n - 1);
		assert.ok(env.videos.calls - reads <= 10, `reads only the page (${env.videos.calls - reads})`);
	});

	it('404 for private (not the owner), deleted, hidden and missing lists', async () => {
		const env = setup({
			playlists: {
				priv: playlist('priv', { isPublic: false, videos: ['v0001'] }),
				del: playlist('del', { isDeleted: true, videos: ['v0001'] }),
				hid: playlist('hid', { isHidden: true, videos: ['v0001'] }),
			},
		});
		for (const id of ['priv', 'del', 'hid', 'nope']) {
			assert.equal((await call(env, 'stranger', 'GET', `/api/playlists/${id}/queue`)).status, 404, id);
		}
		assert.equal((await call(env, OWNER, 'GET', '/api/playlists/priv/queue')).status, 200);
	});

	it('WL: the caller\'s Watch later in their order; the stored id is never playable or returned', async () => {
		const wl = { ...playlist('watch-later-u1', { userId: 'u1', channelId: '', isPublic: false, videos: ['v0005', 'v0002', 'v0007'] }), systemType: 'watch_later' };
		const env = setup({ playlists: { 'watch-later-u1': wl } });
		const res = await call(env, 'u1', 'GET', '/api/playlists/WL/queue?video=v0002');
		assert.equal(res.status, 200);
		assert.deepEqual(queueIds(res), ['v0005', 'v0002', 'v0007']);
		assert.equal(res.body.result.position, 1);
		assert.equal(res.body.result.playlist.id, 'WL');
		assert.equal(res.body.result.playlist.kind, 'watch_later');
		assert.doesNotMatch(JSON.stringify(res.body), /watch-later-u1/);
		// Another user gets their own (empty) Watch later; signed out is 404; the raw id is 404 even for the owner
		const other = await call(env, 'u2', 'GET', '/api/playlists/WL/queue');
		assert.equal(other.body.result.total, 0);
		assert.equal((await call(env, null, 'GET', '/api/playlists/WL/queue')).status, 404);
		assert.equal((await call(env, 'u1', 'GET', '/api/playlists/watch-later-u1/queue')).status, 404);
	});

	it('LL: the caller\'s liked videos, newest like first', async () => {
		const env = setup({ liked: [['u1', 'v0001', 100], ['u1', 'v0004', 300], ['u1', 'v0002', 200], ['u2', 'v0009', 400]] });
		const res = await call(env, 'u1', 'GET', '/api/playlists/LL/queue');
		assert.deepEqual(queueIds(res), ['v0004', 'v0002', 'v0001']);
		assert.equal(res.body.result.playlist.kind, 'liked');
		assert.equal((await call(env, null, 'GET', '/api/playlists/LL/queue')).status, 404);
	});
});
