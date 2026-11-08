import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { ListWatchHistory } from '../src/endpoints/watch-history/list';
import { GetWatchHistorySettings, UpdateWatchHistorySettings } from '../src/endpoints/watch-history/settings';
import { RecommendationsGet } from '../src/endpoints/discovery/discovery';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/**
 * Watch history pipeline:
 * - WatchHistory queue messages must use the QueueMessage envelope
 *   ({ id, type, payload, timestamp }); the endpoints sent { type: "WatchHistory", data }
 *   which the processor rejects as an invalid message structure.
 * - Pause: while paused nothing is stored or queued; existing entries stay.
 * - Legacy (imported) videos carry the channel name in `channel` and no channelId.
 */

function routes(r: any) {
	r.get('/api/watch-history/settings', GetWatchHistorySettings);
	r.put('/api/watch-history/settings', UpdateWatchHistorySettings);
	r.post('/api/watch-history', RecordWatchHistory);
	r.get('/api/watch-history', ListWatchHistory);
	r.post('/api/watch-history/:videoId/progress', UpdateWatchProgress);
}

const json = { 'Content-Type': 'application/json' };

function env(videos: Record<string, unknown> = { v1: videoFixture({ title: 'Lecture', channelName: 'Chan' }) }) {
	return {
		videos: new MemoryBucket(videos),
		watch_history: new MemoryBucket(),
		profiles: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

describe('watch history queue events', () => {
	it('record and progress send WatchHistory messages in the processor envelope', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });

		const record = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 10, duration: 100 }) }, e);
		assert.equal(record.status, 201, await record.clone().text());
		const progress = await app.request('/api/watch-history/v1/progress', { method: 'POST', headers: json, body: JSON.stringify({ progress: 99, duration: 100 }) }, e);
		assert.equal(progress.status, 200, await progress.clone().text());

		assert.equal(e.queue.messages.length, 2);
		for (const message of e.queue.messages) {
			assert.equal(message.type, MessageType.WatchHistory);
			assert.equal(typeof message.id, 'string');
			assert.equal(typeof message.timestamp, 'number');
			assert.equal(message.payload.userId, 'me');
			assert.equal(message.payload.videoId, 'v1');
		}
		assert.equal(e.queue.messages[0].payload.type, 'watch_started');
		assert.equal(e.queue.messages[1].payload.type, 'watch_completed');
	});

	it('a zero duration does not store NaN percentages', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const record = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 5, duration: 0 }) }, e);
		assert.equal(record.status, 201);
		assert.equal(e.watch_history.read('me:v1').percentageWatched, 0);
	});
});

describe('legacy videos', () => {
	it('uses the legacy `channel` name when channelName/channelId are missing', async () => {
		const e = env({ v1: videoFixture({ channelId: null, channel: 'Mostafa Elbadry' }) });
		const app = buildApp(routes, { userId: 'me' });
		const record = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 1, duration: 100 }) }, e);
		assert.equal(record.status, 201);
		assert.equal(e.watch_history.read('me:v1').channelName, 'Mostafa Elbadry');
	});
});

describe('pause watch history', () => {
	it('defaults to not paused', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });
		const res = await app.request('/api/watch-history/settings', {}, e);
		assert.deepEqual(await res.json(), { paused: false });
	});

	it('while paused, record/progress store and queue nothing; resuming records again', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'me' });

		await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 10, duration: 100 }) }, e);
		const pause = await app.request('/api/watch-history/settings', { method: 'PUT', headers: json, body: JSON.stringify({ paused: true }) }, e);
		assert.deepEqual(await pause.json(), { paused: true });
		assert.equal(e.profiles.read('me').watchHistoryPaused, true);

		const queued = e.queue.messages.length;
		const progress = await app.request('/api/watch-history/v1/progress', { method: 'POST', headers: json, body: JSON.stringify({ progress: 80, duration: 100 }) }, e);
		assert.equal(progress.status, 200);
		assert.equal((await progress.json()).paused, true);
		assert.equal(e.watch_history.read('me:v1').progress, 10, 'existing entry is kept unchanged');

		e.videos.store.set('v2', JSON.stringify(videoFixture({ id: 'v2' })));
		const other = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v2', progress: 10, duration: 100 }) }, e);
		assert.equal(other.status, 200);
		assert.equal(e.watch_history.store.has('me:v2'), false);
		assert.equal(e.queue.messages.length, queued, 'nothing queued while paused');

		const list = await app.request('/api/watch-history', {}, e);
		assert.equal((await list.json()).total, 1);

		await app.request('/api/watch-history/settings', { method: 'PUT', headers: json, body: JSON.stringify({ paused: false }) }, e);
		const resumed = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v2', progress: 10, duration: 100 }) }, e);
		assert.equal(resumed.status, 201);
		assert.equal(e.watch_history.store.has('me:v2'), true);
	});

	it('pausing keeps the rest of an existing profile', async () => {
		const e = env();
		e.profiles.store.set('me', JSON.stringify({ id: 'me', email: 'me@x', displayName: 'Me', channels: ['c1'] }));
		const app = buildApp(routes, { userId: 'me' });
		await app.request('/api/watch-history/settings', { method: 'PUT', headers: json, body: JSON.stringify({ paused: true }) }, e);
		const profile = e.profiles.read('me');
		assert.equal(profile.displayName, 'Me');
		assert.deepEqual(profile.channels, ['c1']);
		assert.equal(profile.watchHistoryPaused, true);
	});
});

describe('recommendations while watch history is paused (#242)', () => {
	function recRoutes(r: any) {
		r.get('/api/recommendations', RecommendationsGet);
	}
	function recEnv(paused: boolean) {
		const videos = {
			v1: videoFixture({ id: 'v1', title: 'Fiqh lesson one', category: 'education', tags: ['fiqh'], uploadStatus: 'ready', availableResolutions: ['720p'] }),
			v2: videoFixture({ id: 'v2', title: 'Fiqh lesson two', category: 'education', tags: ['fiqh'], uploadStatus: 'ready', availableResolutions: ['720p'] }),
		};
		return {
			videos: new MemoryBucket(videos),
			watch_history: new MemoryBucket({ 'me:v1': { userId: 'me', videoId: 'v1', lastWatchedAt: '2026-11-01T00:00:00.000Z' } }),
			profiles: new MemoryBucket(paused ? { me: { id: 'me', watchHistoryPaused: true } } : {}),
			channels: new MemoryBucket(),
		};
	}

	it('uses history to seed and exclude when not paused', async () => {
		const app = buildApp(recRoutes, { userId: 'me' });
		const res = await app.request('/api/recommendations?excludeWatched=true', {}, recEnv(false));
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as { basedOn: string[]; data: { id: string }[] };
		assert.ok(body.basedOn.includes('history'), JSON.stringify(body.basedOn));
		assert.ok(!body.data.some((v) => v.id === 'v1'), 'a watched video was recommended');
	});

	it('ignores history while paused', async () => {
		const app = buildApp(recRoutes, { userId: 'me' });
		const res = await app.request('/api/recommendations?excludeWatched=true', {}, recEnv(true));
		assert.equal(res.status, 200, await res.clone().text());
		const body = (await res.json()) as { basedOn: string[]; data: { id: string }[] };
		assert.ok(!body.basedOn.includes('history'), JSON.stringify(body.basedOn));
		assert.ok(body.data.some((v) => v.id === 'v1'), 'history still filtered the results while paused');
	});
});
