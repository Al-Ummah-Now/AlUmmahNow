import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaPlayUrl } from '@al-ummah/shared-types';
import { handlePrivate } from '../src/edge';
import type { Env } from '../src/env';

const VID = '0b3c2a1e-1111-2222-3333-444455556666';
const REV = 'abcdefgh12345678';
const HOST = 'media.qa.alummahnow.net';

function fakeBucket(objects: Record<string, string>) {
	const reads: string[] = [];
	return {
		reads,
		async get(key: string) {
			reads.push(key);
			const body = objects[key];
			if (body === undefined) return null;
			return { body: new Response(body).body, size: body.length, httpEtag: '"e"', httpMetadata: {}, range: undefined };
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
