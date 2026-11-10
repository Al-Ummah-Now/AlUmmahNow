/**
 * Upload endpoints act only on videos the caller owns.
 *
 * - The unused server-side stream upload route (POST /api/videos/upload/stream)
 *   is no longer served: browser uploads go through the TUS proxy, whose
 *   sessions are bound to the user at initiate time.
 * - Endpoints that take an existing video id (complete, chapters) reject
 *   callers who do not own the video.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getContractDocument, listServedRoutes } from '../src/index';
import { UPLOAD_SESSION_PATHS } from '../src/middleware/upload-limits';
import { UploadCompleteEndpoint } from '../src/endpoints/video/uploadComplete';
import { VideoChaptersUpdate } from '../src/endpoints/video/chaptersUpdate';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

const OWNER = { userId: 'owner' };
const OTHER = { userId: 'someone-else' };
const CHAPTERS = [{ id: '00000000-0000-4000-8000-000000000001', startTime: 0, endTime: 60, title: 'Intro' }];

function env(videos: MemoryBucket) {
	return { videos, channels: new MemoryBucket(), profiles: new MemoryBucket(), queue: new MemoryQueue() };
}

function stored(videos: MemoryBucket): Record<string, any> {
	return JSON.parse(videos.store.get('v1')!);
}

function uploadingVideo() {
	return new MemoryBucket({ v1: videoFixture({ id: 'v1', userId: 'owner', uploadStatus: 'uploading', duration: 120 }) });
}

describe('POST /api/videos/upload/stream', () => {
	it('is not served by the worker', () => {
		const served = listServedRoutes().filter((r) => /\/upload\/stream\/?$/.test(r.path));
		assert.deepEqual(served, []);
	});

	it('is not part of the public API contract', async () => {
		const doc = await getContractDocument();
		assert.ok(!Object.keys(doc.paths).some((p) => p.endsWith('/upload/stream')));
	});

	it('is not listed as an upload session path', () => {
		assert.ok(!(UPLOAD_SESSION_PATHS as readonly string[]).includes('/api/videos/upload/stream'));
	});
});

describe('POST /api/videos/upload/complete ownership', () => {
	const routes = (r: any) => r.post('/api/videos/upload/complete', UploadCompleteEndpoint);
	const complete = (auth: { userId: string } | null, videos: MemoryBucket) =>
		buildApp(routes, auth).request(
			'/api/videos/upload/complete',
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'v1', fileSize: 1024 }) },
			env(videos),
		);

	it('rejects unauthenticated callers with 401', async () => {
		const videos = uploadingVideo();
		assert.equal((await complete(null, videos)).status, 401);
		assert.equal(stored(videos).uploadStatus, 'uploading');
	});

	it('rejects a non-owner with 403 and leaves the video untouched', async () => {
		const videos = uploadingVideo();
		assert.equal((await complete(OTHER, videos)).status, 403);
		assert.equal(stored(videos).uploadStatus, 'uploading');
	});

	it('lets the owner complete the upload', async () => {
		const videos = uploadingVideo();
		const res = await complete(OWNER, videos);
		assert.equal(res.status, 200);
		assert.equal(stored(videos).uploadStatus, 'processing');
	});
});

describe('PUT /api/videos/:id/chapters ownership', () => {
	const routes = (r: any) => r.put('/api/videos/:id/chapters', VideoChaptersUpdate);
	const update = (auth: { userId: string } | null, videos: MemoryBucket) =>
		buildApp(routes, auth).request(
			'/api/videos/v1/chapters',
			{ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapters: CHAPTERS }) },
			env(videos),
		);

	it('rejects unauthenticated callers with 401', async () => {
		assert.equal((await update(null, uploadingVideo())).status, 401);
	});

	it('rejects a non-owner with 403', async () => {
		const videos = uploadingVideo();
		assert.equal((await update(OTHER, videos)).status, 403);
		assert.equal(stored(videos).hasChapters, undefined);
	});

	it('lets the owner update chapters', async () => {
		const videos = uploadingVideo();
		assert.equal((await update(OWNER, videos)).status, 200);
		assert.equal(stored(videos).hasChapters, true);
	});
});
