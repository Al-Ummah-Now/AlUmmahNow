import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { originalManifestKey, originalPartKey, partsCover, partsFromKeys, planOriginalRange } from '@al-ummah/shared-types';
import { parseRange, serveOriginal } from '../src/originals';

const VID = '0b3c2a1e-1111-2222-3333-444455556666';

// Workers' FixedLengthStream, for Node (length checks are the runtime's job)
(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

/** Bucket fake with ranged gets and listings. */
function bucket(objects: Record<string, Uint8Array | string>) {
	const bytes = (v: Uint8Array | string) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);
	return {
		async get(key: string, opts?: { range?: { offset: number; length: number } }) {
			const v = objects[key];
			if (v === undefined) return null;
			const b = bytes(v);
			const slice = opts?.range ? b.slice(opts.range.offset, opts.range.offset + opts.range.length) : b;
			return { body: new Response(slice).body!, json: async () => JSON.parse(new TextDecoder().decode(b)) };
		},
		async list(o: { prefix: string }) {
			return { objects: Object.keys(objects).filter((k) => k.startsWith(o.prefix)).sort().map((key) => ({ key, size: bytes(objects[key]!).length })), truncated: false };
		},
	};
}

describe('original parts', () => {
	it('sees overlaps (a resumed PATCH) as covered, and a gap as incomplete', () => {
		const parts = [{ key: 'a', offset: 0, size: 10 }, { key: 'b', offset: 8, size: 10 }, { key: 'c', offset: 18, size: 2 }];
		assert.deepEqual(partsCover(parts, 20), { complete: true });
		assert.deepEqual(partsCover([parts[0]!, parts[2]!], 20), { complete: false, firstGapAt: 10 });
		assert.deepEqual(partsCover([parts[0]!], 20), { complete: false, firstGapAt: 10 });
	});
	it('plans each byte once across overlapping parts', () => {
		const parts = [{ key: 'a', offset: 0, size: 10 }, { key: 'b', offset: 8, size: 10 }];
		assert.deepEqual(planOriginalRange(parts, 5, 14), [{ key: 'a', from: 5, to: 9 }, { key: 'b', from: 2, to: 6 }]);
		assert.deepEqual(planOriginalRange([{ key: 'a', offset: 0, size: 4 }, { key: 'c', offset: 6, size: 4 }], 0, 9), [{ key: 'a', from: 0, to: 3 }]);
	});
	it('reads part offsets from keys of one upload id only', () => {
		const objs = [
			{ key: originalPartKey(VID, 'up1', 5242880), size: 5 },
			{ key: originalPartKey(VID, 'up1', 0), size: 5 },
			{ key: originalPartKey(VID, 'up0', 0), size: 9 },
			{ key: originalManifestKey(VID), size: 1 },
		];
		assert.deepEqual(partsFromKeys(objs, VID, 'up1').map((p) => p.offset), [0, 5242880]);
	});
	it('parses Range headers', () => {
		assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
		assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
		assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
		assert.equal(parseRange('bytes=200-', 100), null);
		assert.deepEqual(parseRange(null, 100), { start: 0, end: 99 });
	});
});

describe('serving a kept original', () => {
	const objects = {
		[originalManifestKey(VID)]: JSON.stringify({ uploadId: 'up1', size: 12, parts: 2, completedAt: 'x' }),
		[originalPartKey(VID, 'up1', 0)]: 'abcdefgh',
		// Resumed at 6: overlaps "gh"
		[originalPartKey(VID, 'up1', 6)]: 'ghijkl',
	};
	it('streams a range across parts with the right headers', async () => {
		const res = await serveOriginal({ MEDIA_ORIGINALS: bucket(objects) as never }, VID, 'bytes=4-11');
		assert.equal(res!.status, 206);
		assert.equal(res!.headers.get('content-range'), 'bytes 4-11/12');
		assert.equal(res!.headers.get('x-media-source'), 'original');
		assert.equal(await res!.text(), 'efghijkl');
	});
	it('gives null (use Bunny) without a manifest or with a gap', async () => {
		const other = '2b3c2a1e-1111-2222-3333-444455556666';
		assert.equal(await serveOriginal({ MEDIA_ORIGINALS: bucket({ [originalPartKey(other, 'up1', 0)]: 'abc' }) as never }, other, null), null);
		const g = '1b3c2a1e-1111-2222-3333-444455556666';
		const gap = { [originalManifestKey(g)]: JSON.stringify({ uploadId: 'up1', size: 12, parts: 1, completedAt: 'x' }), [originalPartKey(g, 'up1', 0)]: 'abcdefgh' };
		assert.equal(await serveOriginal({ MEDIA_ORIGINALS: bucket(gap) as never }, g, null), null);
	});
});
