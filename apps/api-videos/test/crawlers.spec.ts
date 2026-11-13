import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOINDEX, robotsTxtResponse, withNoIndex } from '../src/lib/crawlers';

test('robots.txt disallows everything and is itself noindex', async () => {
	const res = robotsTxtResponse(new Request('https://videos.api.alummahnow.net/robots.txt'));
	assert.ok(res);
	assert.equal(await res.text(), 'User-agent: *\nDisallow: /\n');
	assert.equal(res.headers.get('X-Robots-Tag'), NOINDEX);
	assert.match(res.headers.get('Content-Type') ?? '', /^text\/plain/);
});

test('robotsTxtResponse ignores every other path', () => {
	assert.equal(robotsTxtResponse(new Request('https://videos.api.alummahnow.net/api/videos')), null);
	assert.equal(robotsTxtResponse(new Request('https://videos.api.alummahnow.net/robots.txt/x')), null);
});

test('withNoIndex adds the header and keeps status and body', async () => {
	const res = withNoIndex(new Response('{"ok":true}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
	assert.equal(res.status, 404);
	assert.equal(res.headers.get('X-Robots-Tag'), NOINDEX);
	assert.equal(res.headers.get('Content-Type'), 'application/json');
	assert.equal(await res.text(), '{"ok":true}');
});

test('withNoIndex copies a response whose headers are immutable', async () => {
	const immutable = Response.redirect('https://videos.alummahnow.net/', 302);
	const res = withNoIndex(immutable);
	assert.equal(res.status, 302);
	assert.equal(res.headers.get('X-Robots-Tag'), NOINDEX);
	assert.equal(res.headers.get('Location'), 'https://videos.alummahnow.net/');
});
