import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SQL, REPORTS_D1, originLine, pathOf, scriptsFor, topFrames, uaFamily } from '../prod-errors.ts';

test('every statement is a bounded SELECT on indexed columns, no LIKE', () => {
	for (const sql of ALL_SQL) {
		assert.match(sql, /^\s*SELECT\b/i);
		assert.match(sql, /\bLIMIT \d+/);
		assert.doesNotMatch(sql, /\bLIKE\b|\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i);
	}
});

test('reads only the reports D1 of production and stage', () => {
	assert.deepEqual(Object.keys(REPORTS_D1).sort(), ['production', 'stage']);
});

test('stage scripts carry -stage, production none', () => {
	for (const s of Object.values(scriptsFor('production')).flat()) assert.doesNotMatch(s, /stag/);
	for (const [app, s] of Object.entries(scriptsFor('stage'))) assert.ok(s.every((x) => /-stag(e|ing)$/.test(x)), app);
	assert.ok(scriptsFor('production').auth!.includes('al-ummah-now-auth'));
});

test('topFrames prefers app frames', () => {
	const stack = 'Error: x\n    at node_modules/hono/a.js:1\n    at handler (src/index.ts:10:5)\n    at y (src/lib/z.ts:2:1)';
	assert.deepEqual(topFrames(stack, 2), ['at handler (src/index.ts:10:5)', 'at y (src/lib/z.ts:2:1)']);
	assert.deepEqual(topFrames(null), []);
});

test('originLine prints the origin compactly', () => {
	assert.equal(originLine(JSON.stringify({ surface: 'android', appVersion: '1.4.0', device: 'phone', country: 'EG', source: 'search:google', referrerHost: 'www.google.com', entry: '/:locale/video/:id' })), 'android 1.4.0 · phone · EG · search:google (www.google.com) · /:locale/video/:id');
	assert.equal(originLine('nope'), '–');
});

test('--paths prints a path without host, query or fragment', () => {
	assert.equal(pathOf('https://auth.alummahnow.net/passkeys/register/verify?lang=ar#x'), '/passkeys/register/verify');
	assert.equal(pathOf('/account/passkeys'), '/account/passkeys');
	assert.equal(pathOf(undefined), '');
});

test('--paths prints the browser family only, never the User-Agent', () => {
	assert.equal(uaFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'Safari/iOS');
	assert.equal(uaFamily('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'), 'Chrome/Android');
	assert.equal(uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0'), 'Edge/Windows');
	assert.equal(uaFamily(undefined), '');
});
