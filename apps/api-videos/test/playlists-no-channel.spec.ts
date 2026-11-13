/**
 * Personal playlists (owner request 2026-11-13: "Playlists should be
 * available without a channel"). A signed-in user with no active channel
 * creates, edits, reorders, deletes and fills their own playlists; the
 * playlist is theirs alone (channelId '', like Watch later). With a channel
 * active the playlist is the channel's, as before. Visibility is public,
 * unlisted (link-only, never listed) or private.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { PlaylistCreate } from '../src/endpoints/playlist/playlistCreate';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { PlaylistDelete } from '../src/endpoints/playlist/playlistDelete';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import { PlaylistRemoveVideo } from '../src/endpoints/playlist/playlistRemoveVideo';
import { PlaylistQueue } from '../src/endpoints/playlist/playlistQueue';
import { PlaylistManageItems, PlaylistVideosBulkAdd, PlaylistVideosReorder } from '../src/endpoints/playlist/playlistBulk';
import { listPlaylists } from '../src/lib/admin/service';
import { footprintsOf } from '../src/lib/privacy/footprints';
import { playlistVisibility, playlistVisibilityFlags, canOpenPlaylist, canViewPlaylist } from '../src/lib/playlists';
import { projectPlaylist } from '@al-ummah/shared-types';
import { MessageType } from '../src/lib/queue';

const ME = 'viewer';

function env() {
	return {
		SEARCH_DB: new SqliteD1(),
		playlists: new MemoryBucket(),
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', title: 'Lesson 1', userId: 'creator', channelId: 'creator-ch' }),
			v2: videoFixture({ id: 'v2', title: 'Lesson 2', userId: 'creator', channelId: 'creator-ch' }),
			v3: videoFixture({ id: 'v3', title: 'Lesson 3', userId: 'creator', channelId: 'creator-ch' }),
			priv: videoFixture({ id: 'priv', title: 'Private', userId: 'creator', channelId: 'creator-ch', isPublic: false }),
		}),
		channels: new MemoryBucket({
			'creator-ch': { id: 'creator-ch', userId: 'creator', name: 'Creator', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' },
			'member-ch': { id: 'member-ch', userId: 'member', name: 'Member', isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' },
		}),
		queue: new MemoryQueue(),
	} as any;
}

const ROUTES = (r: any) => {
	r.get('/api/playlists', PlaylistsList);
	r.post('/api/playlists', PlaylistCreate);
	r.get('/api/playlists/:id', PlaylistFetch);
	r.patch('/api/playlists/:id', PlaylistUpdate);
	r.delete('/api/playlists/:id', PlaylistDelete);
	r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	r.delete('/api/playlists/:id/videos/:videoId', PlaylistRemoveVideo);
	r.post('/api/playlists/:id/videos/bulk', PlaylistVideosBulkAdd);
	r.put('/api/playlists/:id/videos/order', PlaylistVideosReorder);
	r.get('/api/playlists/:id/items', PlaylistManageItems);
	r.get('/api/playlists/:id/queue', PlaylistQueue);
};

async function call(e: any, user: string | null, method: string, path: string, body?: unknown, channelId?: string) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (channelId) headers.channelId = channelId;
	const res = await buildApp(ROUTES, user ? { userId: user } : null).request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, e);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createPersonal(e: any, body: Record<string, unknown> = {}) {
	const res = await call(e, ME, 'POST', '/api/playlists', { title: 'My lessons', ...body });
	assert.equal(res.status, 200, JSON.stringify(res.body));
	return res.body.result.playlist;
}

describe('personal playlists: a user without a channel', () => {
	it('creates one without the channelId header: the user owns it, channelId is empty', async () => {
		const e = env();
		const playlist = await createPersonal(e);
		const stored = e.playlists.read(playlist.id);
		assert.equal(stored.userId, ME);
		assert.equal(stored.channelId, '');
		assert.equal(playlist.channelId, '');
		assert.equal(playlist.visibility, 'public');
		const event = e.queue.messages.find((m: any) => m.type === MessageType.PlaylistCreate);
		assert.equal(event.payload.userId, ME);
		assert.equal('channelId' in event.payload, false, 'no empty channel on the event');
	});

	it('creates with videos in order; any public video, never a private one', async () => {
		const e = env();
		const res = await call(e, ME, 'POST', '/api/playlists', { title: 'Saved', videos: ['v2', 'v1', 'priv'] });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.deepEqual(e.playlists.read(res.body.result.playlist.id).videos, ['v2', 'v1']);
		assert.equal(res.body.result.add.notInChannel, 1);
	});

	it('adds, removes, bulk-adds and reorders videos; edits details and deletes', async () => {
		const e = env();
		const { id } = await createPersonal(e);
		assert.equal((await call(e, ME, 'POST', `/api/playlists/${id}/videos`, { videoId: 'v1' })).status, 200);
		assert.equal((await call(e, ME, 'POST', `/api/playlists/${id}/videos`, { videoId: 'priv' })).status, 404, 'another user\'s private video stays out');
		const bulk = await call(e, ME, 'POST', `/api/playlists/${id}/videos/bulk`, { videoIds: ['v2', 'v3'] });
		assert.ok(bulk.status < 300, JSON.stringify(bulk.body));
		assert.deepEqual(e.playlists.read(id).videos, ['v1', 'v2', 'v3']);

		const reorder = await call(e, ME, 'PUT', `/api/playlists/${id}/videos/order`, { videoIds: ['v3', 'v1', 'v2'] });
		assert.ok(reorder.status < 300, JSON.stringify(reorder.body));
		assert.deepEqual(e.playlists.read(id).videos, ['v3', 'v1', 'v2']);

		const items = await call(e, ME, 'GET', `/api/playlists/${id}/items`);
		assert.equal(items.status, 200);
		assert.deepEqual(items.body.result.items.map((i: any) => [i.id, i.video?.title]), [['v3', 'Lesson 3'], ['v1', 'Lesson 1'], ['v2', 'Lesson 2']]);
		assert.equal(items.body.result.playlist.channelId, '');

		assert.equal((await call(e, ME, 'DELETE', `/api/playlists/${id}/videos/v1`)).status, 200);
		assert.deepEqual(e.playlists.read(id).videos, ['v3', 'v2']);

		const renamed = await call(e, ME, 'PATCH', `/api/playlists/${id}`, { title: 'Renamed', titleLocalized: { en: 'Renamed', ar: 'مُعاد التسمية' } });
		assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
		assert.equal(e.playlists.read(id).title, 'Renamed');

		assert.equal((await call(e, ME, 'DELETE', `/api/playlists/${id}`)).status, 200);
		assert.equal(e.playlists.read(id), null);
	});

	it('nobody else may change it, with or without a channel', async () => {
		const e = env();
		const { id } = await createPersonal(e);
		assert.equal((await call(e, 'member', 'PATCH', `/api/playlists/${id}`, { title: 'x' }, 'member-ch')).status, 403);
		assert.equal((await call(e, 'other', 'POST', `/api/playlists/${id}/videos`, { videoId: 'v1' })).status, 403);
		assert.equal((await call(e, 'other', 'DELETE', `/api/playlists/${id}`)).status, 403);
		assert.ok(e.playlists.read(id));
	});

	it('lists them with ?mine=true (private and unlisted included); never another user\'s or a channel\'s', async () => {
		const e = env();
		const pub = await createPersonal(e, { title: 'Public one' });
		const priv = await createPersonal(e, { title: 'Private one', visibility: 'private' });
		const unl = await createPersonal(e, { title: 'Unlisted one', visibility: 'unlisted' });
		await call(e, 'member', 'POST', '/api/playlists', { title: 'Channel one' }, 'member-ch');
		await call(e, 'other', 'POST', '/api/playlists', { title: 'Someone else' });

		const mine = await call(e, ME, 'GET', '/api/playlists?mine=true&limit=50');
		assert.equal(mine.status, 200);
		assert.deepEqual(mine.body.data.map((p: any) => p.id).sort(), [pub.id, priv.id, unl.id].sort());
		assert.equal((await call(e, null, 'GET', '/api/playlists?mine=true')).status, 401);
	});

	it('with a channel active the playlist is the channel\'s, as before', async () => {
		const e = env();
		const res = await call(e, 'member', 'POST', '/api/playlists', { title: 'Channel lessons' }, 'member-ch');
		assert.equal(res.status, 200);
		assert.equal(e.playlists.read(res.body.result.playlist.id).channelId, 'member-ch');
		const mine = await call(e, 'member', 'GET', '/api/playlists?mine=true');
		assert.deepEqual(mine.body.data, [], 'channel playlists are not personal ones');
		const listed = await call(e, null, 'GET', '/api/playlists?channelId=member-ch');
		assert.deepEqual(listed.body.data.map((p: any) => p.title), ['Channel lessons']);
	});
});

describe('playlist visibility: public, unlisted, private', () => {
	it('maps visibility to the stored flags (visibility wins over isPublic)', () => {
		assert.deepEqual(playlistVisibilityFlags({ visibility: 'unlisted', isPublic: true }), { isPublic: false, isUnlisted: true });
		assert.deepEqual(playlistVisibilityFlags({ visibility: 'private' }), { isPublic: false, isUnlisted: false });
		assert.deepEqual(playlistVisibilityFlags({ isPublic: true }), { isPublic: true, isUnlisted: false });
		assert.deepEqual(playlistVisibilityFlags({}), {});
		assert.equal(playlistVisibility({ isPublic: false, isUnlisted: true }), 'unlisted');
		assert.equal(playlistVisibility({}), 'public');
	});

	it('an unlisted playlist opens by link (page and queue) for anyone, but is never listed or searched', async () => {
		const e = env();
		const res = await call(e, ME, 'POST', '/api/playlists', { title: 'Link only', visibility: 'unlisted', videos: ['v1', 'v2'] });
		const { id } = res.body.result.playlist;
		assert.equal(res.body.result.playlist.visibility, 'unlisted');

		const page = await call(e, null, 'GET', `/api/playlists/${id}`);
		assert.equal(page.status, 200, 'opens for a signed-out visitor with the link');
		assert.equal(page.body.visibility, 'unlisted');
		const queue = await call(e, 'stranger', 'GET', `/api/playlists/${id}/queue`);
		assert.equal(queue.status, 200, JSON.stringify(queue.body));
		assert.deepEqual(queue.body.result.items.map((i: any) => i.videoId ?? i.id), ['v1', 'v2']);

		const all = await call(e, 'stranger', 'GET', '/api/playlists?limit=50');
		assert.equal(all.body.data.some((p: any) => p.id === id), false, 'not in public lists');
		assert.equal(projectPlaylist(e.playlists.read(id)), null, 'not in search');
		assert.equal(canViewPlaylist(e.playlists.read(id), 'stranger'), false);
		assert.equal(canOpenPlaylist(e.playlists.read(id), 'stranger'), true);
	});

	it('a private playlist opens for its owner only; switching to public lists it', async () => {
		const e = env();
		const { id } = await createPersonal(e, { visibility: 'private' });
		assert.equal((await call(e, null, 'GET', `/api/playlists/${id}`)).status, 404);
		assert.equal((await call(e, 'stranger', 'GET', `/api/playlists/${id}/queue`)).status, 404);
		assert.equal((await call(e, ME, 'GET', `/api/playlists/${id}`)).status, 200);

		const made = await call(e, ME, 'PATCH', `/api/playlists/${id}`, { visibility: 'public' });
		assert.equal(made.status, 200, JSON.stringify(made.body));
		assert.equal(e.playlists.read(id).isPublic, true);
		assert.equal(e.playlists.read(id).isUnlisted, false);
		assert.equal((await call(e, null, 'GET', `/api/playlists/${id}`)).status, 200);

		await call(e, ME, 'PATCH', `/api/playlists/${id}`, { visibility: 'unlisted' });
		assert.deepEqual([e.playlists.read(id).isPublic, e.playlists.read(id).isUnlisted], [false, true]);
	});
});

describe('privacy and moderation see personal playlists', () => {
	it('the footprint names the owner; admin lists it as personal, with its visibility', async () => {
		const e = env();
		const { id } = await createPersonal(e, { visibility: 'unlisted' });
		const [fp] = footprintsOf('playlists', id, e.playlists.read(id));
		assert.deepEqual(fp.userIds, [ME]);
		const admin = await listPlaylists(e, { ownerId: ME });
		assert.deepEqual(admin.items.map((p: any) => [p.id, p.channelId, p.isPublic, p.isUnlisted]), [[id, null, false, true]]);
	});
});
