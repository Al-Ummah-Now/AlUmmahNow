/**
 * Discovery reads only video objects from the videos bucket (prod 2026-11-17: web's share card
 * JPEGs under share-cards/ were fetched and parsed as video JSON on /api/trending).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isVideoObjectKey, loadDiscoverableVideos } from '../src/lib/discovery';
import { MemoryBucket, videoFixture } from './helpers';

describe('discovery: video keys only', () => {
	it('skips index, metadata, live stream and nested keys', () => {
		assert.equal(isVideoObjectKey('55e83716-15ca-41d9-af12-12d7a7e44e79'), true);
		for (const key of ['share-cards/v3/v/a85f13/415a06.jpg', 'index:latest', 'metadata:x', 'livestream:1', '']) assert.equal(isVideoObjectKey(key), false, key);
	});

	it('never reads a share card image while loading videos', async () => {
		const bucket = new MemoryBucket();
		const video = videoFixture({ id: 'vid-public-1' } as never);
		bucket.store.set('vid-public-1', JSON.stringify(video));
		bucket.store.set('share-cards/v3/v/a85f13/415a06.jpg', 'ÿØÿàJFIF');
		const got: string[] = [];
		const spy = new Proxy(bucket, { get: (t, k) => (k === 'get' ? (key: string) => (got.push(key), t.get(key)) : (t as never)[k]) });
		await loadDiscoverableVideos(spy as never);
		assert.deepEqual(got, ['vid-public-1']);
	});
});
