import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WatchHistoryEntry } from '@al-ummah/shared-types';
import { ContinueWatchingList, WatchStateList, WatchStatePut } from '../src/endpoints/watch-state/watchState';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { UpdateWatchHistorySettings } from '../src/endpoints/watch-history/settings';
import {
	MAX_CLOCK_SKEW_MS,
	applyWatchState,
	changesSince,
	clampClientTime,
	isContinueWatching,
} from '../src/lib/watch-state';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/**
 * Watch-state sync & Continue watching (Epic 9.9):
 * - last writer wins on the client clock, clamped to server time + 5 min
 * - ties and older writes keep the stored state (applied: false)
 * - the web progress endpoints take part at server time
 * - incremental sync by server time; Continue watching is 5% <= pct < 95%,
 *   newest first, without removed or private videos
 */

const json = { 'Content-Type': 'application/json' };

function routes(r: any) {
	r.put('/api/watch-history/settings', UpdateWatchHistorySettings);
	r.post('/api/watch-history', RecordWatchHistory);
	r.post('/api/watch-history/:videoId/progress', UpdateWatchProgress);
	r.get('/api/watch-state', WatchStateList);
	r.put('/api/watch-state/:videoId', WatchStatePut);
	r.get('/api/continue-watching', ContinueWatchingList);
}

function env(videos: Record<string, unknown> = { v1: videoFixture({ title: 'Lecture', channelName: 'Chan' }) }) {
	return {
		videos: new MemoryBucket(videos),
		watch_history: new MemoryBucket(),
		profiles: new MemoryBucket(),
		channels: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

function entry(videoId: string, overrides: Partial<WatchHistoryEntry> = {}): WatchHistoryEntry {
	return {
		id: `me:${videoId}`,
		userId: 'me',
		videoId,
		videoTitle: videoId,
		videoDuration: 100,
		channelId: 'owner-ch',
		channelName: 'Chan',
		firstWatchedAt: '2026-11-01T00:00:00.000Z',
		lastWatchedAt: '2026-11-01T00:00:00.000Z',
		watchCount: 1,
		progress: 50,
		completed: false,
		percentageWatched: 50,
		...overrides,
	};
}

const iso = (ms: number) => new Date(ms).toISOString();

async function put(app: any, e: any, videoId: string, body: Record<string, unknown>) {
	const res = await app.request(`/api/watch-state/${videoId}`, { method: 'PUT', headers: json, body: JSON.stringify(body) }, e);
	return { status: res.status, body: (await res.json()) as any };
}

describe('watch-state rules', () => {
	const now = new Date('2026-11-08T12:00:00.000Z');

	it('clamps a client clock in the future to server time + 5 min', () => {
		assert.equal(clampClientTime('2030-01-01T00:00:00Z', now).getTime(), now.getTime() + MAX_CLOCK_SKEW_MS);
		assert.equal(clampClientTime('2026-11-08T11:00:00Z', now).toISOString(), '2026-11-08T11:00:00.000Z');
		assert.equal(clampClientTime('garbage', now).getTime(), now.getTime());
	});

	it('applies newer writes, keeps the stored state on older writes and ties', () => {
		const e = entry('v1', { stateUpdatedAt: '2026-11-08T11:00:00.000Z' });
		assert.equal(applyWatchState(e, { position: 10, duration: 100, clientUpdatedAt: '2026-11-08T10:59:59Z' }, now), false);
		assert.equal(applyWatchState(e, { position: 10, duration: 100, clientUpdatedAt: '2026-11-08T11:00:00Z' }, now), false);
		assert.equal(e.progress, 50);
		assert.equal(applyWatchState(e, { position: 70, duration: 100, clientUpdatedAt: '2026-11-08T11:00:01Z', deviceId: 'tv' }, now), true);
		assert.equal(e.progress, 70);
		assert.equal(e.percentageWatched, 70);
		assert.equal(e.stateDeviceId, 'tv');
		assert.equal(e.lastWatchedAt, now.toISOString(), 'the sync cursor is server time');
	});

	it('uses lastWatchedAt as the clock of entries written before 9.9', () => {
		const e = entry('v1', { lastWatchedAt: '2026-11-08T11:00:00.000Z' });
		assert.equal(applyWatchState(e, { position: 1, duration: 100, clientUpdatedAt: '2026-11-08T10:00:00Z' }, now), false);
	});

	it('completed sticks once reached', () => {
		const e = entry('v1');
		applyWatchState(e, { position: 99, duration: 100, clientUpdatedAt: '2026-11-08T11:00:00Z' }, now);
		applyWatchState(e, { position: 3, duration: 100, clientUpdatedAt: '2026-11-08T11:30:00Z' }, now);
		assert.equal(e.completed, true);
		assert.equal(e.percentageWatched, 3);
	});

	it('continue watching is 5% <= pct < 95%', () => {
		assert.deepEqual([0, 4, 5, 50, 94, 95, 100].map((p) => isContinueWatching({ percentageWatched: p })), [false, false, true, true, true, false, false]);
	});

	it('changesSince is inclusive, oldest first, limited', () => {
		const list = [entry('a', { lastWatchedAt: iso(3000) }), entry('b', { lastWatchedAt: iso(1000) }), entry('c', { lastWatchedAt: iso(2000) })];
		assert.deepEqual(changesSince(list, iso(2000), 10).items.map((e) => e.videoId), ['c', 'a']);
		const page = changesSince(list, undefined, 2);
		assert.deepEqual(page.items.map((e) => e.videoId), ['b', 'c']);
		assert.equal(page.hasMore, true);
	});
});

describe('PUT /api/watch-state/:videoId', () => {
	it('creates the entry when missing and queues watch_started', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const res = await put(app, e, 'v1', { position: 30, duration: 100, clientUpdatedAt: new Date().toISOString(), deviceId: 'phone' });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.equal(res.body.applied, true);
		assert.equal(res.body.state.position, 30);
		assert.equal(res.body.state.deviceId, 'phone');
		const stored = e.watch_history.read('me:v1');
		assert.equal(stored.videoTitle, 'Lecture');
		assert.equal(stored.channelName, 'Chan');
		assert.equal(e.queue.messages.at(-1).payload.type, 'watch_started');
	});

	it('an older write returns applied: false with the newer stored state', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const t = Date.now();
		await put(app, e, 'v1', { position: 60, duration: 100, clientUpdatedAt: iso(t) });
		const stale = await put(app, e, 'v1', { position: 10, duration: 100, clientUpdatedAt: iso(t - 60_000) });
		assert.equal(stale.status, 200);
		assert.equal(stale.body.applied, false);
		assert.equal(stale.body.state.position, 60);
		assert.equal(e.watch_history.read('me:v1').progress, 60);
		assert.equal(e.queue.messages.length, 1, 'a rejected write queues nothing');
	});

	it('a device with a clock far in the future cannot pin its position', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const before = Date.now();
		await put(app, e, 'v1', { position: 10, duration: 100, clientUpdatedAt: '2099-01-01T00:00:00Z' });
		const clock = Date.parse(e.watch_history.read('me:v1').stateUpdatedAt);
		assert.ok(clock <= Date.now() + MAX_CLOCK_SKEW_MS && clock >= before + MAX_CLOCK_SKEW_MS, 'stored clock is clamped');
		// Once real time passes the clamp, an honest device wins again
		const stored = e.watch_history.read('me:v1');
		const later = new Date(clock + 1000);
		assert.equal(applyWatchState(stored, { position: 80, duration: 100, clientUpdatedAt: later.toISOString() }, later), true);
	});

	it('web progress writes take part at server time', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		await put(app, e, 'v1', { position: 10, duration: 100, clientUpdatedAt: iso(Date.now() - 60_000), deviceId: 'tv' });
		const web = await app.request('/api/watch-history/v1/progress', { method: 'POST', headers: json, body: JSON.stringify({ progress: 40, duration: 100 }) }, e);
		assert.equal(web.status, 200);
		const stored = e.watch_history.read('me:v1');
		assert.ok(stored.stateUpdatedAt);
		assert.equal(stored.stateDeviceId, undefined);
		const stale = await put(app, e, 'v1', { position: 5, duration: 100, clientUpdatedAt: iso(Date.now() - 30_000) });
		assert.equal(stale.body.applied, false);
	});

	it('stores nothing while history is paused', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		await app.request('/api/watch-history/settings', { method: 'PUT', headers: json, body: JSON.stringify({ paused: true }) }, e);
		const res = await put(app, e, 'v1', { position: 30, duration: 100, clientUpdatedAt: new Date().toISOString() });
		assert.deepEqual(res.body, { applied: false, paused: true, state: null });
		assert.equal(e.watch_history.read('me:v1') ?? null, null);
	});

	it('404s for missing, removed or someone else\'s private videos', async () => {
		const e = env({ gone: videoFixture({ id: 'gone', isDeleted: true }), priv: videoFixture({ id: 'priv', isPublic: false }) });
		const app = buildApp(routes, { userId: 'me' });
		for (const id of ['nope', 'gone', 'priv']) {
			const res = await put(app, e, id, { position: 1, duration: 100, clientUpdatedAt: new Date().toISOString() });
			assert.equal(res.status, 404, id);
		}
	});

	it('rejects a bad body', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		assert.equal((await put(app, e, 'v1', { position: -1, duration: 100, clientUpdatedAt: new Date().toISOString() })).status, 400);
		assert.equal((await put(app, e, 'v1', { position: 1, duration: 100, clientUpdatedAt: 'yesterday' })).status, 400);
	});
});

describe('GET /api/watch-state', () => {
	it('returns changes since a server time, with a cursor for the next sync', async () => {
		const e = env();
		e.watch_history = new MemoryBucket({
			'me:a': entry('a', { lastWatchedAt: iso(1000) }),
			'me:b': entry('b', { lastWatchedAt: iso(2000) }),
			'me:c': entry('c', { lastWatchedAt: iso(3000) }),
			'other:a': entry('a', { id: 'other:a', userId: 'other', lastWatchedAt: iso(4000) }),
		});
		const app = buildApp(routes, { userId: 'me' });
		const first = (await (await app.request('/api/watch-state?limit=2', {}, e)).json()) as any;
		assert.deepEqual(first.items.map((s: any) => s.videoId), ['a', 'b']);
		assert.equal(first.hasMore, true);
		const next = (await (await app.request(`/api/watch-state?since=${first.nextSince}`, {}, e)).json()) as any;
		assert.deepEqual(next.items.map((s: any) => s.videoId), ['b', 'c']);
		assert.equal(next.hasMore, false);
		assert.equal(next.nextSince, iso(3000));
	});

	it('keeps the cursor when nothing changed', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const res = (await (await app.request(`/api/watch-state?since=${iso(5000)}`, {}, e)).json()) as any;
		assert.deepEqual(res.items, []);
		assert.equal(res.nextSince, iso(5000));
	});
});

describe('GET /api/continue-watching', () => {
	it('lists in-progress videos newest first, without finished, removed or private ones', async () => {
		const e = env({
			v1: videoFixture({ id: 'v1', title: 'One' }),
			v2: videoFixture({ id: 'v2', title: 'Two', thumbnailUrl: 'https://img/2.jpg' }),
			done: videoFixture({ id: 'done' }),
			fresh: videoFixture({ id: 'fresh' }),
			gone: videoFixture({ id: 'gone', isHidden: true }),
			priv: videoFixture({ id: 'priv', isPublic: false }),
			mine: videoFixture({ id: 'mine', isPublic: false, userId: 'me' }),
		});
		e.watch_history = new MemoryBucket({
			'me:v1': entry('v1', { lastWatchedAt: iso(1000), percentageWatched: 40 }),
			'me:v2': entry('v2', { lastWatchedAt: iso(3000), percentageWatched: 10, progress: 10 }),
			'me:done': entry('done', { lastWatchedAt: iso(4000), percentageWatched: 97 }),
			'me:fresh': entry('fresh', { lastWatchedAt: iso(5000), percentageWatched: 2 }),
			'me:gone': entry('gone', { lastWatchedAt: iso(6000) }),
			'me:priv': entry('priv', { lastWatchedAt: iso(7000) }),
			'me:mine': entry('mine', { lastWatchedAt: iso(2000) }),
			'me:deleted-video': entry('deleted-video', { lastWatchedAt: iso(8000) }),
		});
		const app = buildApp(routes, { userId: 'me' });
		const res = await app.request('/api/continue-watching', {}, e);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(body.items.map((i: any) => i.videoId), ['v2', 'mine', 'v1']);
		assert.equal(body.items[0].video.title, 'Two');
		assert.equal(body.items[0].video.thumbnailUrl, 'https://img/2.jpg');
		assert.equal(body.items[0].position, 10);
	});

	it('respects the limit', async () => {
		const videos: Record<string, unknown> = {};
		const history: Record<string, unknown> = {};
		for (let i = 0; i < 30; i++) {
			videos[`v${i}`] = videoFixture({ id: `v${i}` });
			history[`me:v${i}`] = entry(`v${i}`, { lastWatchedAt: iso(i * 1000) });
		}
		const e = env(videos);
		e.watch_history = new MemoryBucket(history);
		const app = buildApp(routes, { userId: 'me' });
		const body = (await (await app.request('/api/continue-watching?limit=5', {}, e)).json()) as any;
		assert.deepEqual(body.items.map((i: any) => i.videoId), ['v29', 'v28', 'v27', 'v26', 'v25']);
	});
});
