/**
 * Our own originals (docs/media-delivery/ORIGINALS.md): the TUS PATCH copy, completion, purge.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { originalManifestKey, originalPartKey } from '@al-ummah/shared-types';
import { completeOriginal, deleteOriginal, MAX_TEE_BYTES, teePatch } from '../src/lib/media/originals';

(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

const VID = '912859ed-e618-4d04-8438-874a74a251dd';

class Bucket {
	store = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
	failPuts = false;
	private t = 0;
	async put(key: string, value: ReadableStream | ArrayBuffer | string) {
		if (this.failPuts) throw new Error('R2 down');
		const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
		this.store.set(key, { bytes, uploaded: new Date(Date.now() + ++this.t) });
		return { key };
	}
	async get(key: string) {
		const v = this.store.get(key);
		return v ? { json: async () => JSON.parse(new TextDecoder().decode(v.bytes)) } : null;
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(o: { prefix: string }) {
		return { objects: [...this.store.entries()].filter(([k]) => k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, size: v.bytes.length, uploaded: v.uploaded })), truncated: false };
	}
}

const body = (s: string) => new Response(s).body!;

describe('original kept from TUS PATCHes', () => {
	it('sends Bunny the exact bytes and keeps a copy keyed by offset', async () => {
		const bucket = new Bucket();
		const tee = teePatch({ MEDIA_ORIGINALS: bucket as never }, body('hello world'), { videoId: VID, uploadId: 'up1', offset: 0, length: 11 });
		assert.equal(await new Response(tee.body).text(), 'hello world');
		assert.equal(await tee.stored, true);
		assert.equal(new TextDecoder().decode(bucket.store.get(originalPartKey(VID, 'up1', 0))!.bytes), 'hello world');
	});

	it('never touches the upload when R2 fails, the length is unknown, or the chunk is too big', async () => {
		const bucket = new Bucket();
		bucket.failPuts = true;
		const failed = teePatch({ MEDIA_ORIGINALS: bucket as never }, body('abc'), { videoId: VID, uploadId: 'up1', offset: 0, length: 3 });
		assert.equal(await new Response(failed.body).text(), 'abc');
		assert.equal(await failed.stored, false);
		const unknown = teePatch({ MEDIA_ORIGINALS: new Bucket() as never }, body('abc'), { videoId: VID, uploadId: 'up1', offset: 0, length: null });
		assert.equal(await unknown.stored, false);
		const big = teePatch({ MEDIA_ORIGINALS: new Bucket() as never }, body('abc'), { videoId: VID, uploadId: 'up1', offset: 0, length: MAX_TEE_BYTES + 1 });
		assert.equal(await big.stored, false);
		const unbound = teePatch({}, body('abc'), { videoId: VID, uploadId: 'up1', offset: 0, length: 3 });
		assert.equal(await new Response(unbound.body).text(), 'abc');
	});

	it('completes only when the newest upload covers the file, overlaps allowed', async () => {
		const bucket = new Bucket();
		const env = { MEDIA_ORIGINALS: bucket as never };
		await bucket.put(originalPartKey(VID, 'old', 0), 'zzzzzzzzzzzz');
		await bucket.put(originalPartKey(VID, 'up1', 0), 'abcdefgh');
		assert.equal(await completeOriginal(env, VID, 12), false, 'gap after byte 8');
		// The client resumed at 6 (Bunny had taken 6 bytes): overlapping part
		await bucket.put(originalPartKey(VID, 'up1', 6), 'ghijkl');
		assert.equal(await completeOriginal(env, VID, 12), true);
		const manifest = await (await bucket.get(originalManifestKey(VID)))!.json();
		assert.equal(manifest.uploadId, 'up1');
		assert.equal(manifest.size, 12);
		assert.equal(manifest.parts, 2);
	});

	it('purge deletes every object of the video', async () => {
		const bucket = new Bucket();
		await bucket.put(originalPartKey(VID, 'up1', 0), 'abc');
		await bucket.put(originalManifestKey(VID), '{}');
		await bucket.put(originalPartKey('other-video-12345678', 'up1', 0), 'x');
		assert.equal(await deleteOriginal({ MEDIA_ORIGINALS: bucket as never }, VID), 2);
		assert.equal(bucket.store.size, 1);
	});
});
