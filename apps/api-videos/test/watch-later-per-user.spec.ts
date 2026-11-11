/**
 * Watch later belongs to the user, never to a channel.
 *
 * Lists made before the fix carried the channel that was active at the first
 * save, so the owner saw "Watch later" among that channel's playlists (channel
 * page Playlists tab, the Studio upload picker of the apps, admin channel
 * playlists). Now: new lists have no channel, every write clears an old one,
 * and every channel-scoped listing skips system playlists whatever they carry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WatchLaterAdd, WatchLaterList, WatchLaterRemove } from '../src/endpoints/library/watchLater';
import { ChannelPlaylistsList } from '../src/endpoints/channel/channelPlaylistsList';
import { PlaylistsList } from '../src/endpoints/playlist/playlistsList';
import { PlaylistFetch } from '../src/endpoints/playlist/playlistFetch';
import { clearWatchLaterChannel, isSystemPlaylist, newWatchLater, watchLaterId } from '../src/lib/library';
import { softDeleteChannelObjectsStep } from '../src/lib/channelDeletion';
import { isListablePlaylist } from '../src/lib/channelSectionRules';
import { listPlaylists as adminListPlaylists } from '../src/lib/admin/service';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const ME = 'me';
const CH_A = 'ch-a';
const CH_B = 'ch-b';
const WL = watchLaterId(ME);
const json = { 'Content-Type': 'application/json' };

const channel = (id: string) => ({ id, userId: ME, name: id, handle: id, dateCreated: '2026-01-01T00:00:00.000Z' });
const playlist = (id: string, o: Record<string, unknown> = {}) => ({
	id, title: id, channelId: CH_A, userId: ME, videos: ['v1'], isPublic: false,
	dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...o,
});
/** A Watch later list as stored before the fix: it carries channel A. */
const legacyWatchLater = () => ({ ...newWatchLater(ME, '2026-01-01T00:00:00.000Z'), channelId: CH_A, videos: ['v1'] });

function env(playlists: Record<string, unknown> = {}) {
	return {
		playlists: new MemoryBucket(playlists),
		videos: new MemoryBucket({ v1: videoFixture({ id: 'v1', channelId: CH_A, userId: ME }), v2: videoFixture({ id: 'v2', channelId: CH_B, userId: ME }) }),
		channels: new MemoryBucket({ [CH_A]: channel(CH_A), [CH_B]: channel(CH_B) }),
		queue: new MemoryQueue(),
	};
}

const app = buildApp((r: any) => {
	r.get('/api/library/watch-later', WatchLaterList);
	r.post('/api/library/watch-later', WatchLaterAdd);
	r.delete('/api/library/watch-later/:videoId', WatchLaterRemove);
	r.get('/api/channels/:id/playlists', ChannelPlaylistsList);
	r.get('/api/playlists', PlaylistsList);
	r.get('/api/playlists/:id', PlaylistFetch);
}, { userId: ME });

const send = (e: unknown, method: string, path: string, body?: unknown, channelId?: string) =>
	app.request(path, { method, headers: { ...json, ...(channelId ? { channelId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, e as never);

async function stored(e: ReturnType<typeof env>, key: string) {
	return JSON.parse(await (await (e.playlists as any).get(key)).text());
}

const ids = (body: any) => ((body.data ?? []) as Array<{ id: string }>).map((p) => p.id).sort();

describe('Watch later is per user, never a channel playlist', () => {
	it('a new list records no channel, whichever channel is active', async () => {
		const e = env();
		assert.equal((await send(e, 'POST', '/api/library/watch-later', { videoId: 'v1' }, CH_A)).status, 200);
		assert.equal((await stored(e, WL)).channelId, '');
		assert.equal(newWatchLater(ME).channelId, '');
	});

	it('is identical across active-channel switches', async () => {
		const e = env();
		await send(e, 'POST', '/api/library/watch-later', { videoId: 'v1' }, CH_A);
		await send(e, 'POST', '/api/library/watch-later', { videoId: 'v2' }, CH_B);
		const asA = await (await send(e, 'GET', '/api/library/watch-later', undefined, CH_A)).json() as any;
		const asB = await (await send(e, 'GET', '/api/library/watch-later', undefined, CH_B)).json() as any;
		const asNone = await (await send(e, 'GET', '/api/library/watch-later')).json() as any;
		assert.deepEqual(asA.result.videoIds, ['v2', 'v1']);
		assert.deepEqual(asB.result, asA.result);
		assert.deepEqual(asNone.result, asA.result);
		assert.equal((await stored(e, WL)).channelId, '');
	});

	it('an add or remove clears the channel of a list made before the fix', async () => {
		const e = env({ [WL]: legacyWatchLater() });
		await send(e, 'POST', '/api/library/watch-later', { videoId: 'v1' }, CH_B); // already saved: still rewritten
		assert.equal((await stored(e, WL)).channelId, '');
		const e2 = env({ [WL]: legacyWatchLater() });
		await send(e2, 'DELETE', '/api/library/watch-later/v-missing');
		assert.equal((await stored(e2, WL)).channelId, '');
		assert.deepEqual((await stored(e2, WL)).videos, ['v1']);
	});

	it('channel playlists (owner view) and /api/playlists?channelId skip it, even when it still carries the channel', async () => {
		const e = env({ [WL]: legacyWatchLater(), mine: playlist('mine') });
		const channelTab = await (await send(e, 'GET', `/api/channels/${CH_A}/playlists?limit=50`)).json();
		assert.deepEqual(ids(channelTab), ['mine']);
		const studio = await (await send(e, 'GET', `/api/playlists?channelId=${CH_A}&limit=50`, undefined, CH_A)).json();
		assert.deepEqual(ids(studio), ['mine']);
	});

	it('opening it shows no channel as its owner', async () => {
		const e = env({ [WL]: legacyWatchLater() });
		const res = await send(e, 'GET', `/api/playlists/${WL}`);
		assert.equal(res.status, 200);
		const body = await res.json() as any;
		const data = body.result ?? body.data ?? body;
		assert.equal(data.channelName, undefined);
		assert.equal(data.channelId, '');
	});

	it('channel sections never pick it', () => {
		assert.equal(isListablePlaylist({ ...legacyWatchLater(), isPublic: true } as never), false);
		assert.equal(isListablePlaylist(playlist('p', { isPublic: true }) as never), true);
	});

	it('admin channel playlists skip it; the unscoped admin list still finds it', async () => {
		const e = env({ [WL]: legacyWatchLater(), mine: playlist('mine') });
		const scoped = await adminListPlaylists(e as never, { channelId: CH_A });
		assert.deepEqual(scoped.items.map((p) => p.id), ['mine']);
		const all = await adminListPlaylists(e as never, {});
		assert.deepEqual(all.items.map((p) => p.id).sort(), ['mine', WL].sort());
	});

	it('deleting or purging the channel never takes the user’s Watch later', async () => {
		const e = env({ [WL]: legacyWatchLater(), mine: playlist('mine') });
		const soft = await softDeleteChannelObjectsStep(e.playlists as never, CH_A);
		assert.equal(soft.removed, 1);
		assert.equal((await stored(e, WL)).isDeleted, undefined);
		const hard = await softDeleteChannelObjectsStep(e.playlists as never, CH_A, { hard: true });
		assert.equal(hard.removed, 1);
		assert.ok(await (e.playlists as any).get(WL));
	});

	it('clearWatchLaterChannel is idempotent; isSystemPlaylist knows it by id or type', () => {
		const wl = legacyWatchLater();
		assert.equal(clearWatchLaterChannel(wl), true);
		assert.equal(clearWatchLaterChannel(wl), false);
		assert.equal(wl.channelId, '');
		assert.equal(isSystemPlaylist({ id: WL }), true);
		assert.equal(isSystemPlaylist({ id: 'x', systemType: 'watch_later' }), true);
		assert.equal(isSystemPlaylist({ id: 'x' }), false);
	});
});
