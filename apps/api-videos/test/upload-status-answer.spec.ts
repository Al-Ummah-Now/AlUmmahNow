/** GET /api/videos/:id/upload-status is its owner's alone. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoUploadStatus } from '../src/endpoints/video/videoUploadStatus';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

describe('upload status', () => {
	it('is kept by no cache', async () => {
		const video = { ...videoFixture({ id: 'v1', userId: 'owner', channelId: 'ch' }), uploadStatus: 'processing', bunnyId: null };
		const env = { videos: new MemoryBucket({ v1: video }), channels: new MemoryBucket({ ch: { id: 'ch', userId: 'owner', name: 'Channel', members: [] } }), queue: new MemoryQueue(), SEARCH_DB: new SqliteD1() };
		const res = await buildApp((r) => r.get('/api/videos/:id/upload-status', VideoUploadStatus), { userId: 'owner' }).request('/api/videos/v1/upload-status', {}, env as never);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
	});
});
