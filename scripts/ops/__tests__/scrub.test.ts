import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, scrub } from '../scrub.ts';

test('credentials, emails, addresses and query strings are dropped, escaped and cut ones too', () => {
	for (const s of [
		'user a.b+c@example.com',
		'a.b%40example.com',
		'{"msg":"failed for private@exampl"}',
		'https://x.y/z?sig=private',
		'GET /api/callback?code=private',
		'Authorization: Bearer private.token',
		'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRl',
		'{"apiKey":"private"}',
		'{"errorBody":"{\\"apiKey\\":\\"private\\"}"}',
		'token=private',
		'x-api-key: private',
	]) {
		assert.doesNotMatch(scrub(s), /private|example|exampl\b|eyJz/, s);
	}
	assert.equal(scrub('from 203.0.113.7 and 2001:db8::1 and ::1'), 'from [ip] and [ip] and [ip]');
});

test('times, routes and ids stay (the report is encrypted)', () => {
	const s = '×27 2026-11-25T13:36:47.318Z GET /api/videos/12345678-9abc-4def-8123-456789abcdef {"ray":"a5fd49bbb8fbe738","durationMs":2150} src/z.ts:211:7';
	assert.equal(scrub(s), s);
});

test('time is linear in the text', () => {
	for (const unit of ['a', 'a.', 'token', '@', '%40', ':', '1.', 'eyJ', '?', '"', '\\"']) {
		const t0 = performance.now();
		scrub(unit.repeat(Math.ceil(200_000 / unit.length)));
		assert.ok(performance.now() - t0 < 2000, `${unit}: ${Math.round(performance.now() - t0)} ms`);
	}
	assert.equal(clip('a'.repeat(50), 10).length, 10);
	assert.equal(clip(undefined, 10), '');
});
