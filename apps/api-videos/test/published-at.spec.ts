import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPublishedState, markPublished } from '../src/lib/published';
import { applyPlan, planSync } from '../src/lib/processing/sync';
import { VideoUpdate } from '../src/endpoints/video/videoUpdate';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { backfillPublishedAt, handlePublishedAtBackfillMessage, runPublishedAtPage } from '../src/lib/publishedAtBackfill';

/**
 * publishedAt: set once when a video first becomes visible to everyone (public, ready, not a draft,
 * not removed), never overwritten. The web's "Published on …" tooltip and newest order read it.
 */
describe('markPublished', () => {
	const at = '2026-11-13T10:00:00.000Z';

	it('stamps the transition into published, and only it', () => {
		const after = { isPublic: true, uploadStatus: 'ready' } as Record<string, unknown>;
		assert.equal(markPublished({ isPublic: false, uploadStatus: 'ready' }, after, at), true);
		assert.equal(after.publishedAt, at);
	});

	it('never overwrites, and an edit to an already public video stamps nothing', () => {
		const kept = { isPublic: true, uploadStatus: 'ready', publishedAt: '2026-01-01T00:00:00.000Z' };
		assert.equal(markPublished({ isPublic: false }, kept, at), false);
		assert.equal(kept.publishedAt, '2026-01-01T00:00:00.000Z');
		const legacy = { isPublic: true, uploadStatus: 'ready' } as Record<string, unknown>;
		assert.equal(markPublished({ isPublic: true, uploadStatus: 'ready' }, legacy, at), false);
		assert.equal(legacy.publishedAt, undefined);
	});

	it('not published: private, a draft, processing, deleted or hidden', () => {
		for (const state of [{ isPublic: false }, { isDraft: true }, { uploadStatus: 'processing' }, { isDeleted: true }, { isHidden: true }]) {
			assert.equal(isPublishedState({ isPublic: true, uploadStatus: 'ready', ...state }), false, JSON.stringify(state));
		}
		// Records from before upload statuses existed count as ready
		assert.equal(isPublishedState({ isPublic: true }), true);
	});
});

describe('publishedAt on the write paths', () => {
	it('a public upload that becomes ready is published at its playable time', () => {
		const NOW = new Date('2026-11-13T09:00:00.000Z');
		const video = { id: 'v1', isPublic: true, uploadStatus: 'processing' as const, dateCreated: '2026-11-13T08:00:00.000Z' };
		applyPlan(video, planSync(video, { guid: 'v1', status: 4, encodeProgress: 100, availableResolutions: '360p' } as never, { host: 'cdn.example', now: NOW }));
		assert.equal((video as { uploadStatus?: string }).uploadStatus, 'ready');
		assert.equal((video as { publishedAt?: string }).publishedAt, NOW.toISOString());
	});

	it('a private upload that becomes ready is not published', () => {
		const video = { id: 'v2', isPublic: false, uploadStatus: 'processing' as const };
		applyPlan(video, planSync(video, { guid: 'v2', status: 4, encodeProgress: 100, availableResolutions: '360p' } as never, { host: 'cdn.example', now: new Date() }));
		assert.equal((video as { publishedAt?: string }).publishedAt, undefined);
	});

	it('PUT /api/videos/:id private → public publishes it; public again later keeps the first date', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', isPublic: false, uploadStatus: 'ready' }) });
		const env = { SEARCH_DB: new SqliteD1(), MODERATION_QUEUE: new MemoryQueue(), queue: new MemoryQueue(), videos } as never;
		const app = buildApp((r: any) => r.put('/api/videos/:id', VideoUpdate), { userId: 'owner' });
		const put = (body: unknown) => app.request('/api/videos/v1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);

		assert.equal((await put({ isPublic: true })).status, 200);
		const first = (videos as unknown as { read(id: string): { publishedAt?: string } }).read('v1').publishedAt;
		assert.ok(first, 'published when made public');

		await put({ isPublic: false });
		await new Promise((r) => setTimeout(r, 5));
		await put({ isPublic: true });
		assert.equal((videos as unknown as { read(id: string): { publishedAt?: string } }).read('v1').publishedAt, first, 'the first publish date stays');
	});
});


describe('publishedAt backfill', () => {
	const bucket = () => new MemoryBucket({
		a: videoFixture({ id: 'a', isPublic: true, uploadStatus: 'ready', dateCreated: '2026-11-11T22:19:00.000Z', playableAt: '2026-11-11T22:21:30.000Z' }),
		b: videoFixture({ id: 'b', isPublic: true, uploadStatus: 'ready', dateCreated: '2026-10-01T08:00:00.000Z' }),
		c: videoFixture({ id: 'c', isPublic: false, uploadStatus: 'ready', dateCreated: '2026-10-02T08:00:00.000Z' }),
		d: videoFixture({ id: 'd', isPublic: true, uploadStatus: 'ready', dateCreated: '2026-10-03T08:00:00.000Z', publishedAt: '2026-10-04T08:00:00.000Z' }),
	});

	it('picks the playable time, else the upload time; skips private and already-set videos', () => {
		assert.deepEqual(backfillPublishedAt({ isPublic: true, uploadStatus: 'ready', dateCreated: '2026-01-01T00:00:00.000Z', playableAt: '2026-01-01T00:03:00.000Z' } as never), { at: '2026-01-01T00:03:00.000Z', source: 'playable' });
		assert.deepEqual(backfillPublishedAt({ isPublic: true, dateCreated: '2026-01-01T00:00:00.000Z' } as never), { at: '2026-01-01T00:00:00.000Z', source: 'created' });
		assert.deepEqual(backfillPublishedAt({ isPublic: false, dateCreated: '2026-01-01T00:00:00.000Z' } as never), { skip: 'notPublished' });
		assert.deepEqual(backfillPublishedAt({ isPublic: true, publishedAt: 'x' } as never), { skip: 'alreadySet' });
	});

	it('a dry run (the default) counts and writes nothing', async () => {
		const videos = bucket();
		const { counts } = await runPublishedAtPage({ videos } as never, { cursor: null, limit: 50 });
		assert.deepEqual(counts, { scanned: 4, fromPlayable: 1, fromCreated: 1, alreadySet: 1, notPublished: 1, noDate: 0 });
		assert.equal((videos as any).read('a').publishedAt, undefined);
	});

	it('applying sets the dates and never touches an existing one; the run is recorded', async () => {
		const videos = bucket();
		const settings = new MemoryBucket();
		const msg = { body: { kind: 'published-at-backfill', runId: 'run-12345678', page: 0, cursor: null, dryRun: false, limit: 50 }, attempts: 1, ack: () => undefined, retry: () => undefined };
		await handlePublishedAtBackfillMessage({ videos, global_settings: settings, PROCESSING_CHECK_QUEUE: new MemoryQueue() } as never, msg);
		assert.equal((videos as any).read('a').publishedAt, '2026-11-11T22:21:30.000Z');
		assert.equal((videos as any).read('b').publishedAt, '2026-10-01T08:00:00.000Z');
		assert.equal((videos as any).read('c').publishedAt, undefined);
		assert.equal((videos as any).read('d').publishedAt, '2026-10-04T08:00:00.000Z');
		const run = JSON.parse(await (await settings.get('ops/published-at/runs/run-12345678.json'))!.text());
		assert.equal(run.status, 'done');
		assert.equal(run.totals.fromPlayable + run.totals.fromCreated, 2);
	});
});
