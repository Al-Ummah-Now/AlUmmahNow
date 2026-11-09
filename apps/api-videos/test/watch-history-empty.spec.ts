import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetWatchProgress } from '../src/endpoints/watch-history/get-progress';
import { UpdateWatchProgress } from '../src/endpoints/watch-history/update-progress';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/** A video nobody has watched yet is a normal state, so it must not answer 404. */
const json = { 'Content-Type': 'application/json' };

function routes(r: any) {
	r.get('/api/watch-history/:videoId/progress', GetWatchProgress);
	r.post('/api/watch-history/:videoId/progress', UpdateWatchProgress);
}

function env() {
	return {
		videos: new MemoryBucket({ v1: videoFixture({ title: 'Lecture', channelName: 'Channel' }) }),
		watch_history: new MemoryBucket(),
		profiles: new MemoryBucket(),
		channels: new MemoryBucket(),
		queue: new MemoryQueue(),
	};
}

const app = () => buildApp(routes, { userId: 'me' });

describe('watch progress with nothing saved', () => {
	it('GET answers 200 with progress null', async () => {
		const res = await app().request('/api/watch-history/v1/progress', {}, env());
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(await res.json(), { videoId: 'v1', progress: null });
	});

	it('POST answers 200 and says nothing was recorded', async () => {
		const res = await app().request('/api/watch-history/v1/progress', { method: 'POST', headers: json, body: JSON.stringify({ progress: 5, duration: 60 }) }, env());
		assert.equal(res.status, 200, await res.clone().text());
		assert.deepEqual(await res.json(), { videoId: 'v1', recorded: false });
	});
});
