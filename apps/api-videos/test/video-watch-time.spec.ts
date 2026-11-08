import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { VideoWatchTime } from '../src/endpoints/video/videoWatchTime';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/** POST /api/videos/:id/watch-time (#235): played-seconds reports become VideoWatchTime messages. */

function routes(r: any) {
	r.post('/api/videos/:id/watch-time', VideoWatchTime);
}

const json = { 'Content-Type': 'application/json' };
const SESSION = 'session-1234';

function limiter(allow: number) {
	let calls = 0;
	const keys: string[] = [];
	return {
		keys,
		limit: async ({ key }: { key: string }) => {
			keys.push(key);
			return { success: ++calls <= allow };
		},
	};
}

function env(overrides: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', channelId: 'c1' }),
			legacy: videoFixture({ id: 'legacy', channelId: null }),
			priv: videoFixture({ id: 'priv', isPublic: false, userId: 'owner' }),
		}),
		queue: new MemoryQueue(),
		...overrides,
	};
}

const post = (app: ReturnType<typeof buildApp>, id: string, body: unknown, e: ReturnType<typeof env>) =>
	app.request(`/api/videos/${id}/watch-time`, { method: 'POST', headers: json, body: JSON.stringify(body) }, e);

describe('POST /api/videos/:id/watch-time', () => {
	it('queues the seconds with the channel in the processor envelope', async () => {
		const e = env();
		const res = await post(buildApp(routes, {}), 'v1', { seconds: 12.345, sessionId: SESSION }, e);
		assert.equal(res.status, 202, await res.clone().text());
		assert.equal(e.queue.messages.length, 1);
		const [m] = e.queue.messages;
		assert.equal(m.type, MessageType.VideoWatchTime);
		assert.equal(m.payload.videoId, 'v1');
		assert.equal(m.payload.videoChannelId, 'c1');
		assert.equal(m.payload.seconds, 12.35);
		assert.equal(m.payload.sessionId, SESSION);
		assert.equal(typeof m.payload.timestamp, 'string');
	});

	it('keeps a null channel for legacy videos', async () => {
		const e = env();
		const res = await post(buildApp(routes, {}), 'legacy', { seconds: 5, sessionId: SESSION }, e);
		assert.equal(res.status, 202);
		assert.equal(e.queue.messages[0].payload.videoChannelId, null);
	});

	it('rejects deltas over 60 s, non-positive deltas and missing sessions', async () => {
		const e = env();
		const app = buildApp(routes, {});
		for (const body of [{ seconds: 61, sessionId: SESSION }, { seconds: 0, sessionId: SESSION }, { seconds: -1, sessionId: SESSION }, { seconds: 5 }]) {
			const res = await post(app, 'v1', body, e);
			assert.equal(res.status, 400, JSON.stringify(body));
		}
		assert.equal(e.queue.messages.length, 0);
	});

	it('answers 404 for unknown and other users\' private videos', async () => {
		const e = env();
		const app = buildApp(routes, { userId: 'someone' });
		assert.equal((await post(app, 'nope', { seconds: 5, sessionId: SESSION }, e)).status, 404);
		assert.equal((await post(app, 'priv', { seconds: 5, sessionId: SESSION }, e)).status, 404);
		assert.equal(e.queue.messages.length, 0);
	});

	it('rate-limits per session and video', async () => {
		const l = limiter(2);
		const e = env({ WATCH_TIME_LIMITER: l });
		const app = buildApp(routes, {});
		const statuses = [];
		for (let i = 0; i < 3; i++) statuses.push((await post(app, 'v1', { seconds: 10, sessionId: SESSION }, e)).status);
		assert.deepEqual(statuses, [202, 202, 429]);
		assert.deepEqual(l.keys, [`${SESSION}:v1`, `${SESSION}:v1`, `${SESSION}:v1`]);
		assert.equal(e.queue.messages.length, 2);
	});

	it('still records when the limiter fails', async () => {
		const e = env({ WATCH_TIME_LIMITER: { limit: async () => { throw new Error('down'); } } });
		const res = await post(buildApp(routes, {}), 'v1', { seconds: 10, sessionId: SESSION }, e);
		assert.equal(res.status, 202);
		assert.equal(e.queue.messages.length, 1);
	});
});
