/**
 * X-Release-Check (packages/shared-types/src/release-check.ts) in the real Workers runtime: what a copied
 * response keeps, and that an "ok" never gets into the Cache API or to anyone else. And this Worker's entry.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare } from 'miniflare';
import worker from '../src/index';

const ID = '48155759-f731-482f-8a64-627bb3a56f48';
const HEADER = 'X-Release-Check';

const ROUTES = `
import { withReleaseCheck } from './release-check.mjs';
const answer = async (request, ctx) => {
	const url = new URL(request.url);
	switch (url.pathname) {
		case '/cached': {
			// Like the endpoints: the response itself goes into the Cache API, a clone of it is what leaves
			const key = new Request('https://cache.test/key');
			const hit = await caches.default.match(key);
			if (hit) return hit;
			const response = new Response('body ' + (globalThis.n = (globalThis.n ?? 0) + 1), { headers: { 'Cache-Control': 'public, max-age=60' } });
			const leaves = response.clone();
			ctx.waitUntil(caches.default.put(key, response));
			return leaves;
		}
		case '/cookies': return new Response('x', { headers: [['Set-Cookie', 'a=1; Path=/'], ['Set-Cookie', 'b=2; Path=/']] });
		case '/204': return new Response(null, { status: 204 });
		case '/304': return new Response(null, { status: 304, headers: { ETag: '"a"' } });
		case '/redirect': return Response.redirect('https://x.test/en', 307);
		case '/stream': {
			const { readable, writable } = new TransformStream();
			ctx.waitUntil((async () => {
				const w = writable.getWriter();
				for (const part of ['one ', 'two ', 'three']) { await w.write(new TextEncoder().encode(part)); await scheduler.wait(20); }
				await w.close();
			})());
			return new Response(readable, { headers: { 'Content-Type': 'text/plain' } });
		}
		case '/ws': {
			const [client, server] = Object.values(new WebSocketPair());
			server.accept();
			server.addEventListener('message', (e) => server.send('echo ' + e.data));
			server.addEventListener('close', () => server.close());
			return new Response(null, { status: 101, webSocket: client });
		}
		default: return new Response(request.method === 'HEAD' ? null : 'hello', { headers: { 'Content-Length': '5', ETag: 'W/"h"' } });
	}
};
export default { fetch: async (request, env, ctx) => withReleaseCheck(request, { CF_VERSION_METADATA: env.VERSION }, await answer(request, ctx)) };
`;

describe('X-Release-Check in the Workers runtime', () => {
	let mf: Miniflare;
	let bare: Miniflare;
	const start = (bindings: Record<string, unknown>) =>
		new Miniflare({
			compatibilityDate: '2025-04-12',
			modules: [
				{ type: 'ESModule', path: 'index.mjs', contents: ROUTES },
				{ type: 'ESModule', path: 'release-check.mjs', contents: stripTypeScriptTypes(readFileSync(new URL('../../../packages/shared-types/src/release-check.ts', import.meta.url), 'utf8')) },
			],
			bindings: bindings as never,
		});
	before(() => {
		mf = start({ VERSION: { id: ID } });
		bare = start({});
	});
	after(async () => {
		await mf.dispose();
		await bare.dispose();
	});
	const ask = (path: string, init: { method?: string; headers?: Record<string, string> } = {}, at = mf) =>
		at.dispatchFetch(`https://x.test${path}`, { redirect: 'manual', ...init, headers: { [HEADER]: ID, ...init.headers } });

	it('an ok is never stored, and never answered to anyone else', async () => {
		const first = await ask('/cached');
		assert.deepEqual([first.headers.get(HEADER), await first.text()], ['ok', 'body 1']);
		// The same stored body, without the proof, for a visitor and for the release of another version
		for (const headers of [undefined, { [HEADER]: '11111111-1111-1111-1111-111111111111' }]) {
			const res = await mf.dispatchFetch('https://x.test/cached', { headers });
			assert.deepEqual([res.headers.get(HEADER), res.headers.get('Cloudflare-CDN-Cache-Control'), await res.text()], [null, null, 'body 1']);
		}
		// From the cache too, the own version proves itself
		const hit = await ask('/cached');
		assert.deepEqual([hit.headers.get(HEADER), await hit.text()], ['ok', 'body 1']);
		const stored = await (await mf.getCaches()).default.match('https://cache.test/key');
		assert.ok(stored);
		assert.deepEqual([stored.headers.get(HEADER), stored.headers.get('Cloudflare-CDN-Cache-Control'), await stored.text()], [null, null, 'body 1']);
	});

	it('several Set-Cookie, empty answers, redirects, HEAD and streams survive the copy', async () => {
		assert.deepEqual((await ask('/cookies')).headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
		assert.deepEqual([(await ask('/204')).status, (await ask('/204')).headers.get(HEADER)], [204, 'ok']);
		const notModified = await ask('/304');
		assert.deepEqual([notModified.status, notModified.headers.get('etag'), notModified.headers.get(HEADER)], [304, '"a"', 'ok']);
		const redirect = await ask('/redirect');
		assert.deepEqual([redirect.status, redirect.headers.get('location'), redirect.headers.get(HEADER)], [307, 'https://x.test/en', 'ok']);
		const head = await ask('/', { method: 'HEAD' });
		assert.deepEqual([head.status, head.headers.get('etag'), head.headers.get(HEADER), await head.text()], [200, 'W/"h"', 'ok', '']);
		const stream = await ask('/stream');
		assert.deepEqual([stream.headers.get(HEADER), await stream.text()], ['ok', 'one two three']);
	});

	it('a WebSocket upgrade goes through untouched', async () => {
		const res = await ask('/ws', { headers: { Upgrade: 'websocket' } });
		assert.deepEqual([res.status, res.headers.get(HEADER)], [101, null]);
		const socket = res.webSocket!;
		const reply = new Promise((r) => socket.addEventListener('message', (e) => r(e.data)));
		socket.accept();
		socket.send('hi');
		assert.equal(await reply, 'echo hi');
		socket.close();
	});

	it('does nothing without the version binding', async () => {
		for (const path of ['/', '/cookies', '/redirect', '/204']) {
			const res = await ask(path, {}, bare);
			await res.text();
			assert.equal(res.headers.get(HEADER), null, path);
		}
	});
});

describe('the api-videos Worker', () => {
	const get = (path: string, headers?: Record<string, string>, env: object = { CF_VERSION_METADATA: { id: ID } }) =>
		worker.fetch(new Request(`https://videos.api.stage.alummahnow.net${path}`, { headers }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);

	it('proves its version on every kind of answer, only when asked for it', async () => {
		for (const path of ['/robots.txt', '/no/such/path']) {
			assert.equal((await get(path, { [HEADER]: ID })).headers.get(HEADER), 'ok', path);
			assert.equal((await get(path)).headers.get(HEADER), null, path);
			assert.equal((await get(path, { [HEADER]: 'other' })).headers.get(HEADER), null, path);
			assert.equal((await get(path, { [HEADER]: ID }, {})).headers.get(HEADER), null, path);
		}
	});
});
