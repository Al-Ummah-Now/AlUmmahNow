/**
 * Profile, watch history, watch later and playlists use conditional writes
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-6/AV-7/AV-19).
 *
 * Each of these objects has several writers at once (other tabs and devices,
 * progress beacons, the privacy consent banner). A blind get → put dropped
 * whichever change landed in between; now every writer applies its change to
 * the fresh object (R2Repository.updateObject), so parallel writers all stick.
 *
 * Runs the real endpoints against an R2 fake that honours `onlyIf` and widens
 * the read → write window (SlowBucket).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { ProfileUpdate } from '../src/endpoints/profile/profileUpdate';
import { WatchHistoryAdd } from '../src/endpoints/profile/watchHistoryAdd';
import { PrivacyConsentPut } from '../src/endpoints/privacy/privacy';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { WatchLaterAdd, WatchLaterRemove, WatchLaterReorder } from '../src/endpoints/library/watchLater';
import { PlaylistAddVideo } from '../src/endpoints/playlist/playlistAddVideo';
import { PlaylistRemoveVideo } from '../src/endpoints/playlist/playlistRemoveVideo';
import { PlaylistUpdate } from '../src/endpoints/playlist/playlistUpdate';
import { watchLaterId } from '../src/lib/library';
import { MemoryBucket, MemoryQueue, SlowBucket, buildApp, videoFixture } from './helpers';

const json = { 'Content-Type': 'application/json' };
const ME = 'me';

function routes(r: any) {
	r.post('/api/profiles', ProfileCreate);
	r.put('/api/profile', ProfileUpdate);
	r.post('/api/profiles/watch-history', WatchHistoryAdd);
	r.put('/api/privacy/consent', PrivacyConsentPut);
	r.post('/api/watch-history', RecordWatchHistory);
	r.post('/api/watch-history/:videoId/progress', UpdateWatchProgress);
	r.post('/api/library/watch-later', WatchLaterAdd);
	r.delete('/api/library/watch-later/:videoId', WatchLaterRemove);
	r.put('/api/library/watch-later/order', WatchLaterReorder);
	r.post('/api/playlists/:id/videos', PlaylistAddVideo);
	r.delete('/api/playlists/:id/videos/:videoId', PlaylistRemoveVideo);
	r.patch('/api/playlists/:id', PlaylistUpdate);
}

const videoIds = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);

function env(opts: { profiles?: Record<string, unknown>; playlists?: Record<string, unknown>; videos?: number } = {}) {
	const videos: Record<string, unknown> = {};
	for (const id of videoIds(opts.videos ?? 60)) videos[id] = videoFixture({ id, title: `Video ${id}`, channelName: 'Chan' });
	return {
		profiles: new SlowBucket(opts.profiles ?? {}),
		playlists: new SlowBucket(opts.playlists ?? {}),
		watch_history: new SlowBucket({}),
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

const app = buildApp(routes, { userId: ME });
const send = (e: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
	app.request(path, { method, headers: { ...json, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, e);

const profile = (overrides: Record<string, unknown> = {}) => ({
	id: ME, email: 'me@test.local', dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides,
});

describe('profile: parallel writers all stick (AV-6)', () => {
	it('an edit, 40 history entries and a consent decision at once all land', async () => {
		const e = env({ profiles: { [ME]: profile({ subscribedTo: ['keep-me'] }) } });
		const ids = videoIds(40);
		const decision = { version: 1, analytics: false, experiments: false, performance: true, decidedAt: '2026-11-06T10:00:00.000Z', source: 'banner' };
		const statuses = await Promise.all([
			send(e, 'PUT', '/api/profile', { displayName: 'New name', bio: 'Bio' }).then((r) => r.status),
			...ids.map((videoId) => send(e, 'POST', '/api/profiles/watch-history', { videoId, watchTime: 5 }).then((r) => r.status)),
			send(e, 'PUT', '/api/privacy/consent', decision).then((r) => r.status),
		]);
		assert.ok(statuses.every((s) => s === 200), `all succeeded: ${statuses.join(',')}`);
		const stored = e.profiles.read(ME);
		assert.equal(stored.displayName, 'New name');
		assert.equal(stored.bio, 'Bio');
		assert.deepEqual(stored.watchHistory.map((h: any) => h.videoId).sort(), [...ids].sort(), 'no history entry lost');
		assert.equal(stored.privacyConsent.history.length, 1, 'the consent record landed');
		assert.equal(stored.privacyConsent.current.performance, true);
		assert.deepEqual(stored.subscribedTo, ['keep-me'], 'fields nobody edited are kept');
	});

	it('creating a profile that already exists keeps its channels, history and consent', async () => {
		const e = env({ profiles: { [ME]: profile({ channels: ['me-ch'], watchHistory: [{ videoId: 'v0' }], privacyConsent: { current: { version: 1 }, history: [{ version: 1 }] } }) } });
		const res = await send(e, 'POST', '/api/profiles', { email: 'me@test.local', displayName: 'Hello' });
		assert.ok(res.status < 300);
		const stored = e.profiles.read(ME);
		assert.equal(stored.displayName, 'Hello');
		assert.deepEqual(stored.channels, ['me-ch']);
		assert.deepEqual(stored.watchHistory, [{ videoId: 'v0' }]);
		assert.equal(stored.privacyConsent.history.length, 1);
	});

	it('a first create racing history adds keeps the profile fields and every entry', async () => {
		const e = env();
		const ids = videoIds(20);
		await Promise.all([
			send(e, 'POST', '/api/profiles', { email: 'me@test.local', displayName: 'First' }),
			...ids.map((videoId) => send(e, 'POST', '/api/profiles/watch-history', { videoId })),
		]);
		const stored = e.profiles.read(ME);
		assert.equal(stored.displayName, 'First');
		assert.deepEqual(stored.watchHistory.map((h: any) => h.videoId).sort(), [...ids].sort());
	});

	it('editing a profile that does not exist is a 404 and creates nothing', async () => {
		const e = env();
		const res = await send(e, 'PUT', '/api/profile', { displayName: 'x' });
		assert.equal(res.status, 404);
		assert.equal(await e.profiles.get(ME), null);
	});

	it('the first history entries of a new user create one profile holding all of them', async () => {
		const e = env();
		const ids = videoIds(25);
		await Promise.all(ids.map((videoId) => send(e, 'POST', '/api/profiles/watch-history', { videoId })));
		assert.deepEqual(e.profiles.read(ME).watchHistory.map((h: any) => h.videoId).sort(), [...ids].sort());
	});
});

describe('watch history entries (AV-7)', () => {
	it('50 parallel records of the same video count 50 views on one entry', async () => {
		const e = env();
		const statuses = await Promise.all(Array.from({ length: 50 }, (_, i) =>
			send(e, 'POST', '/api/watch-history', { videoId: 'v1', progress: i, duration: 100 }).then((r) => r.status)));
		assert.ok(statuses.every((s) => s === 200 || s === 201), statuses.join(','));
		const entry = e.watch_history.read(`${ME}:v1`);
		assert.equal(entry.watchCount, 50, 'every record counted exactly once');
		assert.equal(entry.channelName, 'Chan');
	});

	it('progress beacons racing a record keep the view count and the furthest flag', async () => {
		const e = env();
		await send(e, 'POST', '/api/watch-history', { videoId: 'v1', progress: 0, duration: 100 });
		await Promise.all([
			...Array.from({ length: 30 }, (_, i) => send(e, 'POST', '/api/watch-history/v1/progress', { progress: 10 + i, duration: 100 })),
			send(e, 'POST', '/api/watch-history/v1/progress', { progress: 99, duration: 100 }),
			...Array.from({ length: 10 }, () => send(e, 'POST', '/api/watch-history', { videoId: 'v1', progress: 1, duration: 100 })),
		]);
		const entry = e.watch_history.read(`${ME}:v1`);
		assert.equal(entry.watchCount, 11, 'no record lost to a beacon');
		assert.equal(entry.completed, true, 'completion is never lost');
	});
});

describe('watch later (AV-19)', () => {
	it('60 parallel adds keep all 60 videos', async () => {
		const e = env();
		const ids = videoIds(60);
		const statuses = await Promise.all(ids.map((videoId) => send(e, 'POST', '/api/library/watch-later', { videoId }).then((r) => r.status)));
		assert.ok(statuses.every((s) => s < 300), statuses.join(','));
		assert.deepEqual([...e.playlists.read(watchLaterId(ME)).videos].sort(), [...ids].sort());
	});

	it('adds and removes in parallel end at the exact set', async () => {
		const e = env();
		const ids = videoIds(40);
		for (const videoId of ids.slice(0, 20)) await send(e, 'POST', '/api/library/watch-later', { videoId });
		await Promise.all([
			...ids.slice(0, 10).map((videoId) => send(e, 'DELETE', `/api/library/watch-later/${videoId}`)),
			...ids.slice(20).map((videoId) => send(e, 'POST', '/api/library/watch-later', { videoId })),
		]);
		assert.deepEqual([...e.playlists.read(watchLaterId(ME)).videos].sort(), [...ids.slice(10)].sort());
	});

	it('a reorder that raced an add is refused instead of dropping the new video', async () => {
		const e = env();
		for (const videoId of ['v0', 'v1', 'v2']) await send(e, 'POST', '/api/library/watch-later', { videoId });
		const [reorder] = await Promise.all([
			send(e, 'PUT', '/api/library/watch-later/order', { videoIds: ['v2', 'v1', 'v0'] }),
			send(e, 'POST', '/api/library/watch-later', { videoId: 'v3' }),
		]);
		const stored = e.playlists.read(watchLaterId(ME)).videos;
		assert.ok(stored.includes('v3'), 'the added video is kept');
		assert.equal(stored.length, 4);
		if (reorder.status === 200) assert.deepEqual(stored.filter((id: string) => id !== 'v3'), ['v2', 'v1', 'v0']);
		else assert.equal(reorder.status, 400);
	});
});

describe('playlists (AV-19)', () => {
	const playlist = (videos: string[] = []) => ({
		pl: { id: 'pl', userId: ME, channelId: 'me-ch', title: 'Mine', videos, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z' },
	});
	const ch = { channelId: 'me-ch' };

	it('50 parallel adds and a rename keep every video and the new title', async () => {
		const e = env({ playlists: playlist() });
		const ids = videoIds(50);
		const statuses = await Promise.all([
			...ids.map((videoId) => send(e, 'POST', '/api/playlists/pl/videos', { videoId }, ch).then((r) => r.status)),
			send(e, 'PATCH', '/api/playlists/pl', { title: 'Renamed' }, ch).then((r) => r.status),
		]);
		assert.ok(statuses.every((s) => s === 200), statuses.join(','));
		const stored = e.playlists.read('pl');
		assert.deepEqual([...stored.videos].sort(), [...ids].sort());
		assert.equal(stored.title, 'Renamed');
	});

	it('adding the same video in parallel stores it once; the others get 400', async () => {
		const e = env({ playlists: playlist() });
		const statuses = await Promise.all(Array.from({ length: 20 }, () =>
			send(e, 'POST', '/api/playlists/pl/videos', { videoId: 'v1' }, ch).then((r) => r.status)));
		assert.equal(statuses.filter((s) => s === 200).length, 1);
		assert.equal(statuses.filter((s) => s === 400).length, 19);
		assert.deepEqual(e.playlists.read('pl').videos, ['v1']);
	});

	it('parallel removes and adds end at the exact set', async () => {
		const ids = videoIds(40);
		const e = env({ playlists: playlist(ids.slice(0, 20)) });
		await Promise.all([
			...ids.slice(0, 15).map((videoId) => send(e, 'DELETE', `/api/playlists/pl/videos/${videoId}`, undefined, ch)),
			...ids.slice(20).map((videoId) => send(e, 'POST', '/api/playlists/pl/videos', { videoId }, ch)),
		]);
		assert.deepEqual([...e.playlists.read('pl').videos].sort(), [...ids.slice(15)].sort());
	});

	it('someone else cannot add to or edit the playlist', async () => {
		const e = env({ playlists: playlist(['v0']) });
		const other = buildApp(routes, { userId: 'mallory' });
		const add = await other.request('/api/playlists/pl/videos', { method: 'POST', headers: { ...json, channelId: 'm-ch' }, body: JSON.stringify({ videoId: 'v1' }) }, e);
		const edit = await other.request('/api/playlists/pl', { method: 'PATCH', headers: { ...json, channelId: 'm-ch' }, body: JSON.stringify({ title: 'pwned' }) }, e);
		assert.equal(add.status, 403);
		assert.equal(edit.status, 403);
		assert.deepEqual(e.playlists.read('pl').videos, ['v0']);
		assert.equal(e.playlists.read('pl').title, 'Mine');
	});
});
