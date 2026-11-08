/**
 * Embed views (docs/embeds/README.md §6): POST /api/videos/:id/view tags the
 * queued VideoView with source / embedOrigin, keeps only the origin of the
 * embedding page, and never counts views of removed or private videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoView } from '../src/endpoints/video/videoView';
import { normalizeEmbedOrigin } from '../src/lib/embed-origin';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

function routes(r: any) {
	r.post('/api/videos/:id/view', VideoView);
}

async function view(videos: MemoryBucket, queue: MemoryQueue, id: string, body: Record<string, unknown>) {
	const app = buildApp(routes);
	return app.request(
		`/api/videos/${id}/view`,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
		{ videos, queue },
	);
}

describe('normalizeEmbedOrigin', () => {
	it('keeps only scheme, host and port', () => {
		assert.equal(normalizeEmbedOrigin('https://Example.org/some/page?x=1#y'), 'https://example.org');
		assert.equal(normalizeEmbedOrigin('http://localhost:4321/a'), 'http://localhost:4321');
	});
	it('refuses non-http schemes, garbage and oversized values', () => {
		assert.equal(normalizeEmbedOrigin('javascript:alert(1)'), null);
		assert.equal(normalizeEmbedOrigin('file:///etc/passwd'), null);
		assert.equal(normalizeEmbedOrigin('not a url'), null);
		assert.equal(normalizeEmbedOrigin(42), null);
		assert.equal(normalizeEmbedOrigin(`https://${'a'.repeat(400)}.org`), null);
	});
});

describe('POST /api/videos/:id/view source tagging', () => {
	it('tags an embed view with its origin and counts it once', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ views: 4 }) });
		const queue = new MemoryQueue();
		const res = await view(videos, queue, 'v1', {
			watchTime: 0,
			source: 'embed',
			embedOrigin: 'https://www.alummahnow.net/articles/eid?utm=x',
		});
		assert.equal(res.status, 200);
		const body = (await res.json()) as { result: { viewCount: number } };
		assert.equal(body.result.viewCount, 5);
		assert.equal(queue.messages.length, 1);
		const payload = queue.messages[0].payload;
		assert.equal(payload.trackedView, true);
		assert.equal(payload.source, 'embed');
		assert.equal(payload.embedOrigin, 'https://www.alummahnow.net');
	});

	it('defaults to the watch page and ignores embedOrigin there', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const queue = new MemoryQueue();
		const res = await view(videos, queue, 'v1', { embedOrigin: 'https://evil.example' });
		assert.equal(res.status, 200);
		assert.equal(queue.messages[0].payload.source, 'watch');
		assert.equal(queue.messages[0].payload.embedOrigin, null);
	});

	it('drops an invalid embed origin but still counts the embed view', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const queue = new MemoryQueue();
		await view(videos, queue, 'v1', { source: 'embed', embedOrigin: 'javascript:alert(1)' });
		assert.equal(queue.messages[0].payload.source, 'embed');
		assert.equal(queue.messages[0].payload.embedOrigin, null);
	});

	for (const [label, overrides] of [
		['deleted', { isDeleted: true }],
		['moderation-hidden', { isHidden: true }],
		['private', { isPublic: false }],
	] as const) {
		it(`does not count a view of a ${label} video`, async () => {
			const videos = new MemoryBucket({ v1: videoFixture({ views: 7, ...overrides }) });
			const queue = new MemoryQueue();
			const res = await view(videos, queue, 'v1', { source: 'embed', embedOrigin: 'https://example.org' });
			assert.equal(res.status, 404);
			assert.equal(queue.messages.length, 0);
			const stored = (await videos.get('v1'))!;
			assert.equal(JSON.parse(await stored.text()).views, 7);
		});
	}
});
