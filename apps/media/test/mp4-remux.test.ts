/** Remux-only jobs: the public MP4 backfill (#1182) and the streamed container uploads. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMp4JobMessage, sanitizeMp4 } from '@al-ummah/shared-types';
import { playlistFiles } from '../container/ladder.mjs';
import { MP4_MAX_ATTEMPTS, mp4QueueAction } from '../src/jobs';
import { storeUpload } from '../src/uploads';

const job = (over: Record<string, unknown> = {}) => ({
	kind: 'mp4',
	videoId: '37bcecd3-2449-4c8d-b4f8-f7af7367d95c',
	jobId: 'job-1',
	rev: 'e29db4ad6918a943',
	access: 'pub',
	rungs: [{ name: '360p', width: 640, height: 360 }, { name: '480p', width: 854, height: 480 }],
	queuedAt: '2026-11-13T00:00:00.000Z',
	...over,
});

describe('isMp4JobMessage', () => {
	it('takes a remux-only job of a ready rendition', () => {
		assert.equal(isMp4JobMessage(job()), true);
	});
	it('refuses transcode jobs, bad ids, bad revs and odd rung names', () => {
		assert.equal(isMp4JobMessage(job({ kind: 'transcode' })), false);
		assert.equal(isMp4JobMessage(job({ videoId: '../x' })), false);
		assert.equal(isMp4JobMessage(job({ rev: 'NOT A REV' })), false);
		assert.equal(isMp4JobMessage(job({ access: 'public' })), false);
		assert.equal(isMp4JobMessage(job({ rungs: [] })), false);
		assert.equal(isMp4JobMessage(job({ rungs: [{ name: '../480p', width: 1, height: 1 }] })), false);
		assert.equal(isMp4JobMessage(null), false);
	});
});

describe('sanitizeMp4', () => {
	it('keeps a well-formed MP4 result', () => {
		assert.deepEqual(sanitizeMp4({ file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 1234 }), { file: 'video.mp4', rung: '480p', width: 854, height: 480, bytes: 1234 });
	});
	it('drops paths, other files, empty files and missing numbers', () => {
		assert.equal(sanitizeMp4({ file: '../video.mp4', rung: '480p', width: 1, height: 1, bytes: 1 }), undefined);
		assert.equal(sanitizeMp4({ file: 'video.webm', rung: '480p', width: 1, height: 1, bytes: 1 }), undefined);
		assert.equal(sanitizeMp4({ file: 'video.mp4', rung: '480p', width: 1, height: 1, bytes: 0 }), undefined);
		assert.equal(sanitizeMp4({ file: 'video.mp4', rung: '480p', width: 'x', height: 1, bytes: 1 }), undefined);
		assert.equal(sanitizeMp4(null), undefined);
	});
});

describe('playlistFiles', () => {
	const playlist = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:6', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:6.0,', 'seg_00001.m4s', '#EXTINF:4.2,', 'seg_00002.m4s', '#EXT-X-ENDLIST', ''].join('\n');
	it('lists the init segment then every media segment', () => {
		assert.deepEqual(playlistFiles(playlist), ['init.mp4', 'seg_00001.m4s', 'seg_00002.m4s']);
	});
	it('refuses a playlist that points outside the rung', () => {
		assert.equal(playlistFiles(playlist.replace('seg_00002.m4s', '../priv/x.m4s')), null);
		assert.equal(playlistFiles(playlist.replace('seg_00002.m4s', 'https://evil.example/x.m4s')), null);
	});
	it('refuses a playlist with no segments', () => {
		assert.equal(playlistFiles('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n'), null);
	});
});

describe('mp4QueueAction', () => {
	it('acks a ready job', () => {
		assert.deepEqual(mp4QueueAction({ outcome: 'ready' }, 1), { ack: true, giveUp: false });
	});
	it('waits while a transcode of the video runs, without using up attempts', () => {
		assert.deepEqual(mp4QueueAction({ outcome: 'busy' }, 7), { ack: false, delaySeconds: 600 });
	});
	it('retries a transient failure with backoff, then gives up', () => {
		assert.deepEqual(mp4QueueAction({ outcome: 'failed' }, 1), { ack: false, delaySeconds: 120 });
		assert.deepEqual(mp4QueueAction({ outcome: 'failed' }, 2), { ack: false, delaySeconds: 240 });
		assert.deepEqual(mp4QueueAction({ outcome: 'failed' }, MP4_MAX_ATTEMPTS), { ack: true, giveUp: true });
	});
	it('gives up at once on a fatal failure (no rung, bad playlist, missing segment)', () => {
		assert.deepEqual(mp4QueueAction({ outcome: 'failed', fatal: true }, 1), { ack: true, giveUp: true });
	});
});

describe('storeUpload', () => {
	// Node has no FixedLengthStream (a Workers global): a pass-through stands in for it
	(globalThis as Record<string, unknown>).FixedLengthStream ??= class extends TransformStream {
		constructor() {
			super();
		}
	};

	function bucket() {
		const puts: { key: string; body: unknown; options: { httpMetadata: { contentType: string; cacheControl: string } } }[] = [];
		return {
			puts,
			async put(key: string, body: unknown, options: (typeof puts)[number]['options']) {
				const value = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array(body as ArrayBuffer);
				puts.push({ key, body: value, options });
				return { key };
			},
		};
	}

	it('streams a body with a Content-Length into R2 with the MP4 type and cache', async () => {
		const b = bucket();
		const data = new Uint8Array([1, 2, 3, 4, 5]);
		const req = new Request('http://mp4.internal/pub/v/r/video.mp4', { method: 'PUT', body: data, headers: { 'content-length': '5' } });
		await storeUpload(b as never, 'pub/v/r/video.mp4', req);
		assert.equal(b.puts.length, 1);
		assert.deepEqual(b.puts[0].body, data);
		assert.equal(b.puts[0].options.httpMetadata.contentType, 'video/mp4');
		assert.match(b.puts[0].options.httpMetadata.cacheControl, /public/);
	});
	it('reads a body without a Content-Length whole', async () => {
		const b = bucket();
		const req = new Request('http://media.internal/pub/v/r/thumb.jpg', { method: 'PUT', body: new Uint8Array([9]) });
		req.headers.delete('content-length');
		await storeUpload(b as never, 'pub/v/r/thumb.jpg', req);
		assert.deepEqual(b.puts[0].body, new Uint8Array([9]));
	});
});
