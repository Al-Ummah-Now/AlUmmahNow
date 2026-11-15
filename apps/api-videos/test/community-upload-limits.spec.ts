/**
 * Community post uploads have one size limit, shared with the web composer
 * (@al-ummah/shared-types COMMUNITY_UPLOAD_LIMITS): images up to 5 MB, GIFs
 * up to 10 MB. Over the limit the API answers 413 with code file_too_large,
 * the file name and the limit, before anything is stored, so the composer can
 * say which file is too large and what the limit is.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_FILE_TOO_LARGE, COMMUNITY_UPLOAD_LIMITS } from '@al-ummah/shared-types';
import { UploadCommunityPostImages } from '../src/endpoints/community/upload-images';
import { UploadCommunityPostGif } from '../src/endpoints/community/upload-gif';
import { MemoryBucket, buildApp } from './helpers';

const realFetch = globalThis.fetch;
let stored: string[];

beforeEach(() => {
	stored = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		if ((init?.method ?? 'GET') === 'PUT') stored.push(new URL(String(input)).pathname);
		return new Response('{}', { status: 201 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0];

function fileOf(head: number[], bytes: number, name: string, type: string): File {
	const data = new Uint8Array(bytes);
	data.set(head);
	return new File([data], name, { type });
}

function harness() {
	const env = {
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: 'alice', name: 'Channel' } }),
		image_storage_key: 'key',
		ZONE: 'zone',
	};
	const app = buildApp((router) => {
		router.post('/api/community/media/upload/images', UploadCommunityPostImages);
		router.post('/api/community/media/upload/gif', UploadCommunityPostGif);
	}, { userId: 'alice' });
	const send = (path: string, field: string, files: File[]) => {
		const form = new FormData();
		for (const f of files) form.append(field, f);
		return app.request(path, { method: 'POST', headers: { channelId: 'ch1' }, body: form }, env);
	};
	return { send };
}

describe('community upload size limits', () => {
	it('the shared limits are 5 MB for images and 10 MB for GIFs', () => {
		assert.equal(COMMUNITY_UPLOAD_LIMITS.imageBytes, 5 * 1024 * 1024);
		assert.equal(COMMUNITY_UPLOAD_LIMITS.gifBytes, 10 * 1024 * 1024);
	});

	it('accepts an image exactly at the limit', async () => {
		const res = await harness().send('/api/community/media/upload/images', 'images', [fileOf(JPEG_HEAD, COMMUNITY_UPLOAD_LIMITS.imageBytes, 'a.jpg', 'image/jpeg')]);
		assert.equal(res.status, 200, await res.clone().text());
		assert.equal(stored.length, 1);
	});

	it('refuses an image over the limit with 413 and stores none of the batch', async () => {
		const res = await harness().send('/api/community/media/upload/images', 'images', [
			fileOf(JPEG_HEAD, 1000, 'small.jpg', 'image/jpeg'),
			fileOf(JPEG_HEAD, COMMUNITY_UPLOAD_LIMITS.imageBytes + 1, 'photo.jpg', 'image/jpeg'),
		]);
		assert.equal(res.status, 413);
		const body = (await res.json()) as Record<string, unknown>;
		assert.equal(body.code, COMMUNITY_FILE_TOO_LARGE);
		assert.equal(body.fileName, 'photo.jpg');
		assert.equal(body.maxBytes, COMMUNITY_UPLOAD_LIMITS.imageBytes);
		assert.equal(body.size, COMMUNITY_UPLOAD_LIMITS.imageBytes + 1);
		assert.deepEqual(stored, []);
	});

	it('accepts a GIF at the limit and refuses one over it with 413', async () => {
		const ok = await harness().send('/api/community/media/upload/gif', 'gif', [fileOf(GIF_HEAD, COMMUNITY_UPLOAD_LIMITS.gifBytes, 'a.gif', 'image/gif')]);
		assert.equal(ok.status, 200, await ok.clone().text());
		const big = await harness().send('/api/community/media/upload/gif', 'gif', [fileOf(GIF_HEAD, COMMUNITY_UPLOAD_LIMITS.gifBytes + 1, 'big.gif', 'image/gif')]);
		assert.equal(big.status, 413);
		const body = (await big.json()) as Record<string, unknown>;
		assert.equal(body.code, COMMUNITY_FILE_TOO_LARGE);
		assert.equal(body.fileName, 'big.gif');
		assert.equal(body.maxBytes, COMMUNITY_UPLOAD_LIMITS.gifBytes);
	});
});
