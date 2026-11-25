import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clip, scrub } from '../scrub.ts';

const UUID = '12345678-9abc-4def-8123-456789abcdef';
const USER = 'usr_0123456789abcdef0123456789abcdef';

test('emails, tokens and query strings are dropped', () => {
	const s = scrub('user a.b+c@example.com token=abc123 https://x.y/z?sig=1 Bearer eyJabc');
	assert.doesNotMatch(s, /example\.com|abc123|sig=1|eyJabc/);
	assert.doesNotMatch(scrub('مستخدم@example.com'), /example/);
});

test('user ids are dropped: in a field, in text, in a path and cut short', () => {
	for (const s of [
		`{"msg":"[auth] Unauthorized admin access attempt","userId":"${USER}"}`,
		`owner ${USER} not found`,
		`/api/users/${USER}/channels`,
		`"ownerId":"${USER.slice(0, 12)}`,
		`{"errorBody":"{\\"userId\\":\\"${USER}\\"}"}`,
		'{"actorId":"someone-else-1234"}',
		'user:0123456789abcdef',
		'userId=someone-else-1234',
	]) {
		const out = scrub(s);
		assert.doesNotMatch(out, /usr_[0-9a-z]|01234567|someone/, s);
	}
	assert.equal(scrub(`{"userId":"${USER}"}`), '{"userId":"…"}');
});

test('video, job, batch and version ids keep 8 characters', () => {
	assert.equal(scrub(`/ar/video/${UUID} →`), '/ar/video/12345678… →');
	assert.equal(scrub(`/api/admin/import/batches/${UUID}/items`), '/api/admin/import/batches/12345678…/items');
	assert.equal(scrub(`{"videoId":"${UUID}","jobId":"${UUID}"}`), '{"videoId":"12345678…","jobId":"12345678…"}');
	assert.equal(scrub(`version ${UUID.toUpperCase()}`), 'version 12345678…');
	assert.equal(scrub(`"videoId":"${UUID.slice(0, 30)}`), '"videoId":"12345678…');
	assert.equal(scrub(`"instanceId":"${'ab12cd34'.repeat(8)}"`), '"instanceId":"ab12cd34…"');
	assert.equal(scrub('{"postId":"V1StGXR8_Z5jdHi6B-myT"}'), '{"postId":"V1StGXR8…"}');
});

test('handles are dropped in paths, encoded paths and fields; our package scopes stay', () => {
	for (const s of ['slow request GET /en/@SomePerson 200', '/ar/@شخص_ما/videos', '/en/%40SomePerson', '/api/channels/by-handle/SomePerson/playlists', '/en/c/SomePerson', '/en/u/SomePerson', '{"handle":"SomePerson"}', 'by @SomePerson.']) {
		assert.doesNotMatch(scrub(s), /SomePerson|شخص/, s);
	}
	assert.equal(scrub('/en/@SomePerson/videos'), '/en/@…/videos');
	const frames = 'at f (node_modules/@some-scope/pkg/index.js:1:2) at g (@al-ummah/shared-types/src/a.ts:3:4) at h (node_modules/.pnpm/@opennextjs+aws@3/x.js:5:6)';
	assert.equal(scrub(frames), frames);
	assert.equal(scrub('/api/channels/by-handle/:handle'), '/api/channels/by-handle/:handle');
});

test('titles, file names, searches, addresses and home or network folders are dropped', () => {
	for (const s of ['{"title":"A private lesson"}', '{"title":"A \\"private\\" lesson"}', '{"fileName":"private.mp4"}', '{"query":"private words"}', '{"errorBody":"{\\"title\\":\\"private\\"}"}', 'at X in C:\\Users\\private\\a.cs', '"path":"C:\\\\Users\\\\private\\\\a.cs"', '/Users/private/a', 'Could not read \\\\nas\\private\\lesson.mp4', '"\\\\\\\\nas\\\\private"']) {
		assert.doesNotMatch(scrub(s), /private/, s);
	}
	assert.equal(scrub('from 203.0.113.7 and 2001:db8::1 and 2001:db8:0:1:2:3:4:5'), 'from [ip] and [ip] and [ip]');
});

test('what an admin needs stays: times, routes, ray and group ids, releases, counts', () => {
	const s = '- ×27 last 2026-11-25T13:36:47.318Z [warn] GET /api/videos {"level":"warn","ray":"a5fd49bbb8fbe738","durationMs":2150,"requestId":"a5facdcf8c1143b7","bundleId":"net.alummahnow.viewer","eventType":"aun:channel-access-changed"} eg_e03c6c3f1e29c7d5 (10dc455049ce) src/lib/z.ts:211:7';
	assert.equal(scrub(s), s);
});

test('scrubbing twice changes nothing more, and clip scrubs before it cuts', () => {
	const s = `${USER} a@b.org @SomePerson ${UUID} {"title":"x","videoId":"${UUID}"} /c/abc 203.0.113.7 token=abc`;
	assert.equal(scrub(scrub(s)), scrub(s));
	for (let n = 1; n < 160; n++) assert.doesNotMatch(clip(`say ${s}`, n), /01234567|a@b|Some|9abc/);
	assert.equal(clip(undefined, 10), '');
});

test('the public reports print nothing that did not go through scrub', () => {
	for (const f of ['prod-errors', 'media-diagnostics']) {
		const src = readFileSync(new URL(`../${f}.ts`, import.meta.url), 'utf8');
		assert.match(src, /const p = \(s = ''\) => out\.push\(scrub\(s\)\);/, f);
		assert.equal(src.match(/out\.push/g)?.length, 1, f);
		assert.doesNotMatch(src, /console\.\w+\(/, f);
		for (const m of src.matchAll(/std(?:out|err)\.write\(([^\n]*)/g)) assert.match(m[1]!, /^out\.join|scrub\(/, f);
		assert.doesNotMatch(src, /(?:message|source|detail|stack|stringify\([^\n]*)\)?\.slice\(0/, `${f}: cut with clip()`);
	}
});
