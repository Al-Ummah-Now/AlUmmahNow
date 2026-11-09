import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { VideoRetention } from '../src/endpoints/video/videoRetention';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/** POST /api/videos/:id/retention: buckets a session reached become VideoRetention messages. */

function routes(r: any) {
	r.post('/api/videos/:id/retention', VideoRetention);
}

const json = { 'Content-Type': 'application/json' };
const SESSION = 'session-1234';

function env(overrides: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket({
			v1: videoFixture({ id: 'v1', channelId: 'c1' }),
			priv: videoFixture({ id: 'priv', isPublic: false, userId: 'owner' }),
			gone: videoFixture({ id: 'gone', isDeleted: true }),
			hidden: videoFixture({ id: 'hidden', isHidden: true }),
		}),
		queue: new MemoryQueue(),
		...overrides,
	};
}

const post = (app: ReturnType<typeof buildApp>, id: string, body: unknown, e: ReturnType<typeof env>) =>
	app.request(`/api/videos/${id}/retention`, { method: 'POST', headers: json, body: JSON.stringify(body) }, e);

describe('POST /api/videos/:id/retention', () => {
	it('queues the buckets in the processor envelope', async () => {
		const e = env();
		const res = await post(buildApp(routes, {}), 'v1', { buckets: [0, 1, 2, 3], sessionId: SESSION }, e);
		assert.equal(res.status, 202, await res.clone().text());
		assert.equal(e.queue.messages.length, 1);
		const [m] = e.queue.messages;
		assert.equal(m.type, MessageType.VideoRetention);
		assert.equal(m.payload.videoId, 'v1');
		assert.deepEqual(m.payload.buckets, [0, 1, 2, 3]);
		assert.equal(m.payload.sessionId, SESSION);
		assert.equal(typeof m.payload.timestamp, 'string');
		assert.equal(m.payload.viewerId, undefined);
	});

	it('rejects invalid buckets and sessions', async () => {
		const e = env();
		const app = buildApp(routes, {});
		for (const body of [
			{ buckets: [], sessionId: SESSION },
			{ buckets: [20], sessionId: SESSION },
			{ buckets: [-1], sessionId: SESSION },
			{ buckets: [1.5], sessionId: SESSION },
			{ buckets: new Array(21).fill(1), sessionId: SESSION },
			{ buckets: [1] },
			{ buckets: [1], sessionId: 'short' },
		]) {
			const res = await post(app, 'v1', body, e);
			assert.equal(res.status, 400, JSON.stringify(body));
		}
		assert.equal(e.queue.messages.length, 0);
	});

	it('gives 404 for missing, deleted, hidden and other people\'s private videos', async () => {
		const e = env();
		const app = buildApp(routes, {});
		for (const id of ['nope', 'gone', 'hidden', 'priv']) {
			const res = await post(app, id, { buckets: [0], sessionId: SESSION }, e);
			assert.equal(res.status, 404, id);
		}
		assert.equal(e.queue.messages.length, 0);
	});

	it('rate-limits per session and video under its own key', async () => {
		const keys: string[] = [];
		const e = env({ WATCH_TIME_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } } });
		const res = await post(buildApp(routes, {}), 'v1', { buckets: [0], sessionId: SESSION }, e);
		assert.equal(res.status, 429);
		assert.deepEqual(keys, [`retention:${SESSION}:v1`]);
		assert.equal(e.queue.messages.length, 0);
	});

	it('still accepts the report when the limiter fails', async () => {
		const e = env({ WATCH_TIME_LIMITER: { limit: async () => { throw new Error('down'); } } });
		const res = await post(buildApp(routes, {}), 'v1', { buckets: [0], sessionId: SESSION }, e);
		assert.equal(res.status, 202);
	});
});
