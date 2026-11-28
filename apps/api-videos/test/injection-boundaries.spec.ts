import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Hono } from 'hono';
import { channelIdMiddleware } from '../src/middleware/auth';

it('validates the selected channel before opening its storage record', async () => {
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('auth' as never, { userId: 'usr_alice', payload: {} } as never);
		await next();
	});
	app.use('*', channelIdMiddleware);
	app.get('/api/videos', (c) => c.text('ok'));
	const env = { channels: { get: async () => { assert.fail('invalid channel must not reach R2'); } } };
	const response = await app.request('/api/videos', { headers: { channelId: 'a'.repeat(129) } }, env);
	assert.equal(response.status, 400);
	assert.equal((await response.json() as { code: string }).code, 'invalid_request');
});

it('keeps request-derived log messages on one line', async (t) => {
	const { logger } = await import('../src/lib/logger');
	const records = t.mock.method(console, 'error', () => {});
	logger.error('Invalid input\nsecond line');
	assert.equal(records.mock.calls.length, 1);
	assert.equal((records.mock.calls[0].arguments[0] as { msg: string }).msg, 'Invalid input\\nsecond line');
});

it('rejects overlong path components before a routed handler runs', async () => {
	const { validateRequestPath } = await import('../src/middleware/request-path');
	const app = new Hono();
	app.use('*', validateRequestPath);
	app.get('/api/records/:id', (c) => c.text(c.req.param('id')));
	const response = await app.request('/api/records/' + 'a'.repeat(513));
	assert.equal(response.status, 400);
	assert.equal((await response.json() as { code: string }).code, 'invalid_request');
	assert.equal(await (await app.request('/api/records/record-1')).text(), 'record-1');
});

it('encodes provider identifiers as one path segment and disables redirects', async (t) => {
	const { BunnyStreamClient } = await import('../src/lib/bunny/stream');
	const calls: Array<[string, RequestRedirect | undefined]> = [];
	t.mock.method(globalThis, 'fetch', async (input: RequestInfo, init?: RequestInit) => {
		calls.push([String(input), init?.redirect]);
		return calls.length === 1 ? Response.json({}) : new Response(null, { status: 302, headers: { Location: 'https://example.org/' } });
	});
	const bunny = new BunnyStreamClient('fixture');
	await bunny.getVideo(123, 'video fixture');
	await assert.rejects(bunny.getVideo(123, 'video fixture'), /status: 302/);
	assert.deepEqual(calls, [
		['https://video.bunnycdn.com/library/123/videos/video%20fixture', 'manual'],
		['https://video.bunnycdn.com/library/123/videos/video%20fixture', 'manual'],
	]);
});

it('accepts only local references in an uploaded HLS playlist', async () => {
	const { isLocalLivePlaylist } = await import('../src/lib/live/edge');
	const head = '#EXTM3U\n';
	assert.equal(isLocalLivePlaylist(head + '#EXT-X-STREAM-INF:BANDWIDTH=100\n720/index.m3u8\n', 'master'), true);
	assert.equal(isLocalLivePlaylist(head + '#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\nseg_123.m4s\n', 'media'), true);
	assert.equal(isLocalLivePlaylist(head + '#EXTINF:5,\nhttps://example.org/video.m4s\n', 'media'), false);
	assert.equal(isLocalLivePlaylist(head + '#EXT-X-MAP:URI="https://example.org/init.mp4"\n', 'media'), false);
});

it('parses bounded TUS metadata and forwards only filename and MIME type to Bunny', async () => {
	const { parseTusMetadata, bunnyUploadMetadata } = await import('../src/lib/bunny/tus');
	const filename = btoa('fixture.mp4');
	const mime = btoa('video/mp4');
	const parsed = parseTusMetadata('tusSessionId ' + btoa('session-1') + ',filename ' + filename + ',filetype ' + mime + ',other ' + btoa('value'));
	assert.equal(parsed?.tusSessionId, 'session-1');
	assert.equal(bunnyUploadMetadata(parsed!), 'filename ' + filename + ',filetype ' + mime);
	assert.equal(parseTusMetadata('filename ' + 'a'.repeat(4097)), null);
	assert.equal(parseTusMetadata('filename invalid!'), null);
});

it('social API requests refuse redirects and require a public HTTPS destination', async () => {
	const { call } = await import('../src/lib/social/adapters/types');
	const visited: RequestRedirect[] = [];
	const fetchFixture = (async (_input: RequestInfo, init?: RequestInit) => {
		visited.push(init?.redirect ?? 'follow');
		return visited.length === 1 ? new Response('{}') : new Response(null, { status: 302, headers: { Location: 'https://example.org/' } });
	}) as typeof fetch;
	await call(fetchFixture, 'https://example.org/api', {}, 'Fixture', 'read');
	await assert.rejects(call(fetchFixture, 'https://example.org/api', {}, 'Fixture', 'read'), /Unexpected upstream redirect/);
	await assert.rejects(call(fetchFixture, 'http://example.org/api', {}, 'Fixture', 'read'), /Invalid destination/);
	assert.deepEqual(visited, ['manual', 'manual']);
});

it('binds the legacy search offset and page limit as SQL data', async () => {
	const { SqliteD1 } = await import('./search-sqlite-d1');
	const { keysetPage } = await import('../src/lib/search/ownership');
	const db = new SqliteD1();
	db.trace = [];
	await keysetPage(db, { kind: 'video', sort: 'latest', where: [], params: [], limit: 11, offset: 23 });
	assert.match(db.trace[0].sql, /LIMIT \? OFFSET \?$/);
	assert.deepEqual(db.trace[0].params, ['video', 12, 23]);
	db.db.close();
});
