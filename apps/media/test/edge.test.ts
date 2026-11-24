import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFileToken, mediaFrameUrl, mediaPlayUrl, mediaToken, mediaTokenExpiry, verifyMediaFileToken } from '@al-ummah/shared-types';
import { handleDownload, handlePrivate } from '../src/edge';
import type { Env } from '../src/env';

const VID = '0b3c2a1e-1111-2222-3333-444455556666';
const REV = 'abcdefgh12345678';
const HOST = 'media.qa.alummahnow.net';

function fakeBucket(objects: Record<string, string>) {
	const reads: string[] = [];
	const heads: string[] = [];
	return {
		reads,
		heads,
		async head(key: string) {
			heads.push(key);
			const body = objects[key];
			if (body === undefined) return null;
			return { size: body.length, httpEtag: '"etag-v1"', httpMetadata: { contentType: 'video/mp4' } };
		},
		async get(key: string, opts?: { range?: { offset?: number; length?: number } | Headers }) {
			reads.push(key);
			const body = objects[key];
			if (body === undefined) return null;
			const rangeOpt = opts?.range && !(opts.range instanceof Headers) ? opts.range : undefined;
			if (rangeOpt && rangeOpt.offset !== undefined && rangeOpt.length !== undefined) {
				const slice = body.slice(rangeOpt.offset, rangeOpt.offset + rangeOpt.length);
				return {
					body: new Response(slice).body,
					size: body.length,
					httpEtag: '"etag-v1"',
					httpMetadata: { contentType: 'video/mp4' },
					range: { offset: rangeOpt.offset, length: slice.length },
				};
			}
			return { body: new Response(body).body, size: body.length, httpEtag: '"etag-v1"', httpMetadata: {}, range: undefined };
		},
	};
}

function fakeCache() {
	const store = new Map<string, Response>();
	return {
		store,
		async match(req: Request) {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		},
		async put(req: Request, res: Response) {
			store.set(req.url, res);
		},
	};
}

function setup(objects: Record<string, string>) {
	const priv = fakeBucket(objects);
	const pub = fakeBucket({});
	const env = { MEDIA: pub, MEDIA_PRIVATE: priv, MEDIA_SIGN_KEY: 'k' } as unknown as Env;
	const waits: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
	return { env, ctx, priv, pub, waits, cache: fakeCache() };
}

describe('/priv/ edge', () => {
	it('a frame\'s file token serves that frame only, never the playlist or a segment', async () => {
		const s = setup({ [`priv/${VID}/${REV}/thumb.jpg`]: 'jpeg', [`priv/${VID}/${REV}/master.m3u8`]: '#EXTM3U', [`priv/${VID}/${REV}/720p/seg_00001.m4s`]: 'seg' });
		const frame = await mediaFrameUrl(HOST, VID, REV, 'k');
		const ok = await handlePrivate(new Request(frame), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(ok.status, 200);
		assert.equal(await ok.text(), 'jpeg');
		for (const file of ['master.m3u8', '720p/seg_00001.m4s']) {
			const res = await handlePrivate(new Request(frame.replace('/thumb.jpg', `/${file}`)), s.env, s.ctx, s.cache as unknown as Cache);
			assert.equal(res.status, 403, `${file} with a frame token`);
		}
	});

	it('file tokens are their own domain: a folder token is not a file token and back', async () => {
		const now = 1_800_000_000;
		const expires = mediaTokenExpiry(now);
		const file = await mediaFileToken('k', VID, REV, 'thumb.jpg', expires);
		assert.ok(await verifyMediaFileToken('k', file, VID, REV, 'thumb.jpg', now));
		assert.ok(!(await verifyMediaFileToken('k', file, VID, REV, 'master.m3u8', now)));
		assert.ok(!(await verifyMediaFileToken('other', file, VID, REV, 'thumb.jpg', now)));
		assert.ok(!(await verifyMediaFileToken('k', file, VID, REV, 'thumb.jpg', now + 8 * 3600)), 'expired');
		const folder = await mediaToken('k', VID, REV, expires);
		assert.ok(!(await verifyMediaFileToken('k', folder, VID, REV, 'thumb.jpg', now)));
		assert.ok(!(await verifyMediaFileToken('k', `f${folder}`, VID, REV, 'thumb.jpg', now)));
	});

	it('serves a signed private file from the private bucket only, then from the edge cache for any token', async () => {
		const s = setup({ [`priv/${VID}/${REV}/master.m3u8`]: '#EXTM3U' });
		const url = await mediaPlayUrl(HOST, 'priv', VID, REV, 'master.m3u8', { key: 'k' });
		const first = await handlePrivate(new Request(url), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(first.status, 200);
		assert.equal(await first.text(), '#EXTM3U');
		assert.equal(first.headers.get('x-media-cache'), 'MISS');
		assert.equal(first.headers.get('access-control-allow-origin'), '*');
		await Promise.all(s.waits);
		assert.deepEqual(s.pub.reads, [], 'never reads the public bucket');
		const other = await mediaPlayUrl(HOST, 'priv', VID, REV, 'master.m3u8', { key: 'k', expires: Math.floor(Date.now() / 1000) + 7200 - (Math.floor(Date.now() / 1000) % 3600) });
		const second = await handlePrivate(new Request(other), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(second.status, 200);
		assert.equal(second.headers.get('x-media-cache'), 'HIT');
		assert.equal(s.priv.reads.length, 1);
	});
	it('refuses a bad or missing token and a path outside the video', async () => {
		const s = setup({ [`priv/${VID}/${REV}/master.m3u8`]: '#EXTM3U' });
		const bad = await handlePrivate(new Request(`https://${HOST}/priv/1999999999.${'A'.repeat(32)}/${VID}/${REV}/master.m3u8`), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(bad.status, 403);
		const none = await handlePrivate(new Request(`https://${HOST}/priv/${VID}/${REV}/master.m3u8`), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(none.status, 404);
		const url = await mediaPlayUrl(HOST, 'priv', VID, REV, '../x', { key: 'k' });
		const trav = await handlePrivate(new Request(url.replace('/../x', '/%2e%2e/x')), s.env, s.ctx, s.cache as unknown as Cache);
		assert.ok(trav.status === 404 || trav.status === 403);
		assert.deepEqual(s.priv.reads, []);
	});
	it('answers 404 for a missing file with a valid token, and preflight with CORS', async () => {
		const s = setup({});
		const url = await mediaPlayUrl(HOST, 'priv', VID, REV, '720p/seg_00001.m4s', { key: 'k' });
		assert.equal((await handlePrivate(new Request(url), s.env, s.ctx, s.cache as unknown as Cache)).status, 404);
		const pre = await handlePrivate(new Request(url, { method: 'OPTIONS' }), s.env, s.ctx, s.cache as unknown as Cache);
		assert.equal(pre.status, 204);
		assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
	});
});

describe('/dl/ Web Download attachment edge (E14-D6)', () => {
	function setupPub(objects: Record<string, string>) {
		const pub = fakeBucket(objects);
		const priv = fakeBucket({ [`priv/${VID}/${REV}/video.mp4`]: 'SECRET-PRIV' });
		const env = { MEDIA: pub, MEDIA_PRIVATE: priv, MEDIA_SIGN_KEY: 'k' } as unknown as Env;
		return { env, pub, priv };
	}

	it('serves public video.mp4 with attachment Content-Disposition, no edge cache, and never reads MEDIA_PRIVATE', async () => {
		const s = setupPub({ [`pub/${VID}/${REV}/video.mp4`]: '0123456789' });
		const res = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/Friday%20Khutbah.mp4`), s.env);
		assert.equal(res.status, 200);
		assert.equal(await res.text(), '0123456789');
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
		assert.equal(res.headers.get('accept-ranges'), 'bytes');
		assert.equal(res.headers.get('etag'), '"etag-v1"');
		assert.equal(res.headers.get('content-length'), '10');
		assert.equal(
			res.headers.get('content-disposition'),
			`attachment; filename="Friday Khutbah.mp4"; filename*=UTF-8''Friday%20Khutbah.mp4`,
		);
		assert.deepEqual(s.priv.reads, []);
		assert.deepEqual(s.priv.heads, []);
	});

	it('handles pure Arabic titles with <videoId>.mp4 ASCII fallback and UTF-8 filename*', async () => {
		const s = setupPub({ [`pub/${VID}/${REV}/video.mp4`]: '0123456789' });
		const arabic = encodeURIComponent('سورة الكهف كاملة.mp4');
		const res = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/${arabic}`), s.env);
		assert.equal(res.status, 200);
		const cd = res.headers.get('content-disposition') ?? '';
		assert.ok(cd.includes(`filename="${VID}.mp4"`), `expected videoId ASCII fallback, got: ${cd}`);
		assert.ok(cd.includes(`filename*=UTF-8''${arabic}`), `expected UTF-8 Arabic filename*, got: ${cd}`);
	});

	it('sanitizes filename injection (CRLF, quotes, semicolons, traversal, bad encoding, non-mp4, >80 chars)', async () => {
		const s = setupPub({ [`pub/${VID}/${REV}/video.mp4`]: '0123456789' });
		const evilCases = [
			'evil%0d%0aX-Injected:%201.mp4',
			'bad%22%3bfilename%3d%22x.exe.mp4',
			'..%2f..%2fsecret.mp4',
			'%252e%252e%252fsecret.mp4',
			'%E0%A4%A.mp4',
			'not-an-mp4.exe',
		];
		for (const raw of evilCases) {
			const res = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/${raw}`), s.env);
			assert.equal(res.status, 200, `case ${raw}`);
			const cd = res.headers.get('content-disposition') ?? '';
			assert.ok(!cd.includes('\r') && !cd.includes('\n'), `no CRLF for ${raw}`);
			assert.ok(!cd.includes('..'), `no traversal for ${raw}`);
			assert.ok(cd.startsWith('attachment; filename="') && cd.includes('.mp4"; filename*=UTF-8\'\''), `safe header for ${raw}: ${cd}`);
		}
		// > 80 char stem clamped to <= 80 chars
		const longTitle = `${'a'.repeat(120)}.mp4`;
		const longRes = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/${longTitle}`), s.env);
		const longCd = longRes.headers.get('content-disposition') ?? '';
		const m = /filename="([^"]+)"/.exec(longCd);
		assert.ok(m && m[1].length <= 84, `stem should clamp to <= 80 + .mp4: ${longCd}`);

		// Bidi override controls (U+202E, U+2066..U+2069, U+200E/F, U+061C) are stripped to prevent extension spoofing
		const bidi = encodeURIComponent('Lecture\u202Egpj.mp4');
		const bidiRes = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/${bidi}`), s.env);
		const bidiCd = bidiRes.headers.get('content-disposition') ?? '';
		assert.ok(!bidiCd.includes('\u202E') && !bidiCd.includes('%E2%80%AE'), `bidi override must be stripped: ${bidiCd}`);
		assert.ok(bidiCd.includes('filename="Lecturegpj.mp4"'), `sanitized bidi filename: ${bidiCd}`);

		// Ordinary title with ellipsis ("Part 1... Intro") preserves title without falling back to videoId
		const ellipsis = encodeURIComponent('Part 1... Intro.mp4');
		const ellipsisRes = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/${ellipsis}`), s.env);
		const ellipsisCd = ellipsisRes.headers.get('content-disposition') ?? '';
		assert.ok(ellipsisCd.includes('filename="Part 1. Intro.mp4"'), `ellipsis title should be preserved: ${ellipsisCd}`);
		assert.ok(!ellipsisCd.includes('..'), `ellipsis must not leave '..': ${ellipsisCd}`);
	});

	it('supports HEAD, Range (206), suffix Range, 416 Range Not Satisfiable, and If-Range/ETag', async () => {
		const s = setupPub({ [`pub/${VID}/${REV}/video.mp4`]: '0123456789' });
		const url = `https://${HOST}/dl/${VID}/${REV}/Lecture.mp4`;

		const head = await handleDownload(new Request(url, { method: 'HEAD' }), s.env);
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-length'), '10');
		assert.equal(head.headers.get('accept-ranges'), 'bytes');
		assert.equal(head.headers.get('etag'), '"etag-v1"');
		assert.equal(await head.text(), '');

		const partial = await handleDownload(new Request(url, { headers: { Range: 'bytes=2-5' } }), s.env);
		assert.equal(partial.status, 206);
		assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
		assert.equal(partial.headers.get('content-length'), '4');
		assert.equal(await partial.text(), '2345');

		const suffix = await handleDownload(new Request(url, { headers: { Range: 'bytes=-3' } }), s.env);
		assert.equal(suffix.status, 206);
		assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
		assert.equal(await suffix.text(), '789');

		const badRange = await handleDownload(new Request(url, { headers: { Range: 'bytes=50-60' } }), s.env);
		assert.equal(badRange.status, 416);
		assert.equal(badRange.headers.get('content-range'), 'bytes */10');

		// If-Range matching strong ETag -> 206
		const ifMatch = await handleDownload(
			new Request(url, { headers: { Range: 'bytes=0-1', 'If-Range': '"etag-v1"' } }),
			s.env,
		);
		assert.equal(ifMatch.status, 206);
		assert.equal(await ifMatch.text(), '01');

		// If-Range mismatching ETag -> full 200
		const ifMismatch = await handleDownload(
			new Request(url, { headers: { Range: 'bytes=0-1', 'If-Range': '"etag-old"' } }),
			s.env,
		);
		assert.equal(ifMismatch.status, 200);
		assert.equal(ifMismatch.headers.get('content-length'), '10');
		assert.equal(await ifMismatch.text(), '0123456789');

		// Weak ETag in If-Range must NOT match (RFC 9110 §13.1.5) -> full 200
		const ifWeak = await handleDownload(
			new Request(url, { headers: { Range: 'bytes=0-1', 'If-Range': 'W/"etag-v1"' } }),
			s.env,
		);
		assert.equal(ifWeak.status, 200);

		// RFC 9110 §14.1.2: unsupported multi-range or non-bytes range unit is ignored -> full 200 OK
		const multiRange = await handleDownload(
			new Request(url, { headers: { Range: 'bytes=0-1,5-6' } }),
			s.env,
		);
		assert.equal(multiRange.status, 200);
		assert.equal(await multiRange.text(), '0123456789');

		const nonBytesRange = await handleDownload(
			new Request(url, { headers: { Range: 'items=0-2' } }),
			s.env,
		);
		assert.equal(nonBytesRange.status, 200);
		assert.equal(await nonBytesRange.text(), '0123456789');
	});

	it('returns 404 immediately once R2 object is deleted across any :filename variant', async () => {
		const s = setupPub({});
		const res1 = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/a.mp4`), s.env);
		const res2 = await handleDownload(new Request(`https://${HOST}/dl/${VID}/${REV}/other-name.mp4`), s.env);
		assert.equal(res1.status, 404);
		assert.equal(res2.status, 404);
	});
});
