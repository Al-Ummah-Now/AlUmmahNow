import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { RecordWatchHistory } from '../src/endpoints/watch-history/record';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { ListWatchHistory } from '../src/endpoints/watch-history/list';
import { GetWatchHistorySettings, UpdateWatchHistorySettings } from '../src/endpoints/watch-history/settings';
import { RecommendationsGet } from '../src/endpoints/discovery/discovery';
import { signBunnyUrlsInText } from '../src/lib/bunny-signing';
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

describe('progress while storage is busy', () => {
	const save = (e: ReturnType<typeof env>, progress = 50) => buildApp(routes, { userId: 'me' }).request('/api/watch-history/v1/progress', { method: 'POST', headers: json, body: JSON.stringify({ progress, duration: 100 }) }, e);
	const started = async () => {
		const e = env();
		await buildApp(routes, { userId: 'me' }).request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 10, duration: 100 }) }, e);
		return e;
	};
	/** The next `times` gets of a bucket fail the way R2 does. */
	const failGets = (bucket: MemoryBucket, times: number, message = 'get: We encountered an internal error. Please try again. (10001)') => {
		const get = bucket.get.bind(bucket);
		let left = times;
		bucket.get = (async (key: string) => {
			if (left-- > 0) throw new Error(message);
			return get(key);
		}) as never;
	};

	it('retries a transient R2 error and saves', async () => {
		for (const bucket of ['watch_history', 'profiles'] as const) {
			const e = await started();
			failGets(e[bucket], 2);
			const res = await save(e);
			assert.equal(res.status, 200, bucket);
			assert.equal(e.watch_history.read('me:v1').progress, 50);
		}
	});

	const busy = async (res: Response) => {
		assert.equal(res.status, 503);
		assert.equal(res.headers.get('Retry-After'), '5');
		assert.equal(res.headers.get('X-Error-Expected'), 'busy');
		assert.equal(((await res.json()) as { code: string }).code, 'busy');
	};

	it('answers 503 busy, never 500, when storage stays down; an unreadable pause setting records nothing', async () => {
		for (const bucket of ['watch_history', 'profiles'] as const) {
			const e = await started();
			failGets(e[bucket], 20);
			await busy(await save(e));
			assert.equal(e.watch_history.read('me:v1').progress, 10);
		}
	});

	it('a transient error while writing is retried, then busy; a write other tabs keep winning is busy', async () => {
		const e = await started();
		const put = e.watch_history.put.bind(e.watch_history);
		let left = 2;
		e.watch_history.put = (async (...args: Parameters<typeof put>) => {
			if (left-- > 0) throw new Error('put: We encountered an internal error. Please try again. (10001)');
			return put(...args);
		}) as never;
		assert.equal((await save(e)).status, 200);
		assert.equal(e.watch_history.read('me:v1').progress, 50);
		left = 20;
		await busy(await save(e, 60));
		e.watch_history.put = (async () => null) as never;
		await busy(await save(e, 70));
		assert.equal(e.watch_history.read('me:v1').progress, 50);
	});

	it('a removed entry is still a 404', async () => {
		const e = await started();
		const get = e.watch_history.get.bind(e.watch_history);
		let reads = 0;
		e.watch_history.get = (async (key: string) => (reads++ === 0 ? get(key) : null)) as never;
		assert.equal((await save(e)).status, 404);
	});

	it('a bug is still a 500', async () => {
		const e = await started();
		failGets(e.watch_history, 20, 'boom');
		assert.equal((await save(e)).status, 500);
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

describe('channel name of channel uploads (#294)', () => {
	function chanEnv() {
		const e = env({ v1: videoFixture({ channelId: 'ch-lectures', title: 'QA Lecture 3' }) }) as any;
		e.channels = new MemoryBucket({ 'ch-lectures': { id: 'ch-lectures', name: 'Al Ummah Now QA — Lectures' } });
		return e;
	}

	it('looks the name up by channelId when the video has no channelName', async () => {
		const e = chanEnv();
		const app = buildApp(routes, { userId: 'me' });
		const record = await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 40, duration: 64 }) }, e);
		assert.equal(record.status, 201);
		assert.equal(e.watch_history.read('me:v1').channelName, 'Al Ummah Now QA — Lectures');
	});

	it('repairs entries stored as "Unknown Channel" when listing and on the next record', async () => {
		const e = chanEnv();
		e.watch_history = new MemoryBucket({
			'me:v1': { id: 'me:v1', userId: 'me', videoId: 'v1', videoTitle: 'QA Lecture 3', videoDuration: 64, channelId: 'ch-lectures', channelName: 'Unknown Channel', firstWatchedAt: '2026-11-08T12:00:00.000Z', lastWatchedAt: '2026-11-08T12:00:00.000Z', watchCount: 1, progress: 40, completed: false, percentageWatched: 62 },
		});
		const app = buildApp(routes, { userId: 'me' });
		const list = await (await app.request('/api/watch-history', {}, e)).json() as any;
		assert.equal(list.entries[0].channelName, 'Al Ummah Now QA — Lectures');

		await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 50, duration: 64 }) }, e);
		assert.equal(e.watch_history.read('me:v1').channelName, 'Al Ummah Now QA — Lectures');
	});

	it('keeps "Unknown Channel" when the channel no longer exists', async () => {
		const e = chanEnv();
		e.channels = new MemoryBucket();
		const app = buildApp(routes, { userId: 'me' });
		await app.request('/api/watch-history', { method: 'POST', headers: json, body: JSON.stringify({ videoId: 'v1', progress: 1, duration: 64 }) }, e);
		assert.equal(e.watch_history.read('me:v1').channelName, 'Unknown Channel');
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
		const res = await app.request('/api/recommendations?excludeWatched=true&limit=1', {}, recEnv(false));
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

describe('watch history thumbnails', () => {
	const host = 'vz-test.b-cdn.net';
	const videoId = '11111111-2222-4333-8444-555555555555';
	const plain = `https://${host}/${videoId}/thumbnail.jpg`;

	function entry(videoThumbnail?: string) {
		return {
			id: `me:${videoId}`,
			userId: 'me',
			videoId,
			videoTitle: 'Lecture',
			videoThumbnail,
			videoDuration: 100,
			channelId: 'c1',
			channelName: 'Chan',
			firstWatchedAt: '2026-11-01T00:00:00.000Z',
			lastWatchedAt: '2026-11-01T00:00:00.000Z',
			watchCount: 1,
			progress: 10,
			completed: false,
			percentageWatched: 10,
		};
	}

	async function listed(video: Record<string, unknown> | null, videoThumbnail?: string) {
		const e = env(video ? { [videoId]: videoFixture({ id: videoId, ...video }) } : {});
		e.watch_history = new MemoryBucket({ [`me:${videoId}`]: entry(videoThumbnail) });
		const app = buildApp(routes, { userId: 'me' });
		const res = await app.request('/api/watch-history', {}, e);
		assert.equal(res.status, 200, await res.clone().text());
		return (await res.text()) as string;
	}
	const thumbnailOf = (body: string) => JSON.parse(body).entries[0].videoThumbnail;

	it('fills in a snapshot stored before the video had a thumbnail', async () => {
		assert.equal(thumbnailOf(await listed({ thumbnailUrl: plain }, undefined)), plain);
	});

	it('prefers the live thumbnail over a stale snapshot', async () => {
		assert.equal(thumbnailOf(await listed({ thumbnailUrl: plain }, `https://${host}/${videoId}/old.jpg`)), plain);
	});

	it('falls back to the snapshot for a deleted or no longer viewable video', async () => {
		const snapshot = `https://${host}/${videoId}/old.jpg`;
		assert.equal(thumbnailOf(await listed(null, snapshot)), snapshot);
		assert.equal(thumbnailOf(await listed({ thumbnailUrl: plain, isPublic: false, userId: 'someone-else' }, snapshot)), snapshot);
	});

	it('carries the live title in every language, so an Arabic page shows the Arabic title', async () => {
		const first = JSON.parse(await listed({ thumbnailUrl: plain, title: 'Weak Hadith 1', titleLocalized: { en: 'Weak Hadith 1', ar: 'الحديث الضعيف ١' } }, plain)).entries[0];
		assert.equal(first.videoTitle, 'Weak Hadith 1');
		assert.deepEqual(first.videoTitleLocalized, { en: 'Weak Hadith 1', ar: 'الحديث الضعيف ١' });
		// Gone or hidden: the stored title only, nothing localized
		const gone = JSON.parse(await listed(null, plain)).entries[0];
		assert.equal(gone.videoTitle, 'Lecture');
		assert.equal(gone.videoTitleLocalized, undefined);
	});

	it('is signed exactly once, even when the snapshot held an expired token', async () => {
		const expired = `${plain}?token=old&expires=1`;
		const signed = await signBunnyUrlsInText(await listed({ thumbnailUrl: plain }, expired), host, 'key');
		const url = thumbnailOf(signed);
		assert.ok(url.startsWith(`${plain}?token=`), url);
		assert.equal(url.match(/token=/g)?.length, 1, url);
		assert.ok(!url.includes('expires=1&') && !url.endsWith('expires=1'), url);
		assert.equal(await signBunnyUrlsInText(signed, host, 'key'), signed);
	});
});
