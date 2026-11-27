import assert from 'node:assert/strict';
import { it } from 'node:test';
import { R2PartConflict, writeR2Part } from '../src/lib/media/r2-tus';

it('uses a create-only PATCH write and handles a rejected precondition without consuming the body', async (t) => {
	class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
		constructor(_length: number) {
			super();
		}
	}
	Object.defineProperty(globalThis, 'FixedLengthStream', { configurable: true, value: TestFixedLengthStream });
	t.after(() => Reflect.deleteProperty(globalThis, 'FixedLengthStream'));
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2, 3]));
		},
	});
	const bucket = {
		async put(key: string, _body: ReadableStream, options: R2PutOptions) {
			assert.equal(key, 'src/video/upload/000000000000000');
			assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' });
			return null;
		},
	};
	await assert.rejects(
		writeR2Part({ MEDIA_ORIGINALS: bucket as unknown as R2Bucket }, { videoId: 'video', uploadKey: 'upload', offset: 0, length: 3, body, createOnly: true }),
		R2PartConflict,
	);
});
