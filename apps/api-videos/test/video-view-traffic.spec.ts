/** Traffic sources (docs/specs/CREATOR-STUDIO.md §8.4): POST /api/videos/:id/view carries where the view came from. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoView } from '../src/endpoints/video/videoView';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

function routes(r: any) {
	r.post('/api/videos/:id/view', VideoView);
}

async function view(body: Record<string, unknown>) {
	const queue = new MemoryQueue();
	const res = await buildApp(routes).request(
		'/api/videos/v1/view',
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
		{ videos: new MemoryBucket({ v1: videoFixture() }), queue },
	);
	return { res, payload: queue.messages[0]?.payload };
}

describe('POST /api/videos/:id/view traffic source', () => {
	it('queues a valid internal source, and no host for it', async () => {
		const { res, payload } = await view({ trafficSource: 'search', referrerHost: 'example.org' });
		assert.equal(res.status, 200);
		assert.equal(payload.trafficSource, 'search');
		assert.equal(payload.referrerHost, undefined);
	});

	it('keeps the normalized host of an external view', async () => {
		const { payload } = await view({ trafficSource: 'external', referrerHost: 'WWW.Example.org' });
		assert.equal(payload.trafficSource, 'external');
		assert.equal(payload.referrerHost, 'www.example.org');
	});

	it('counts the view but drops a host that is not a bare host', async () => {
		const { res, payload } = await view({ trafficSource: 'external', referrerHost: 'example.org/secret?x=1' });
		assert.equal(res.status, 200);
		assert.equal(payload.trafficSource, 'external');
		assert.equal(payload.referrerHost, undefined);
	});

	it('refuses an unknown source', async () => {
		const { res, payload } = await view({ trafficSource: 'bogus' });
		assert.equal(res.status, 400);
		assert.equal(payload, undefined);
	});

	it('sends unknown when an older client sends no source', async () => {
		const { res, payload } = await view({ watchTime: 0 });
		assert.equal(res.status, 200);
		assert.equal(payload.trafficSource, 'unknown');
	});
});
