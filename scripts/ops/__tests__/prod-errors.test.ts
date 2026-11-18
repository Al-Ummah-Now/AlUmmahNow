import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SQL, REPORTS_D1, scriptsFor, scrub, topFrames } from '../prod-errors.ts';

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

test('scrub drops emails, tokens and query strings', () => {
	const s = scrub('user a.b+c@example.com token=abc123 https://x.y/z?sig=1 Bearer eyJabc');
	assert.doesNotMatch(s, /example\.com|abc123|sig=1|eyJabc/);
});

test('topFrames prefers app frames', () => {
	const stack = 'Error: x\n    at node_modules/hono/a.js:1\n    at handler (src/index.ts:10:5)\n    at y (src/lib/z.ts:2:1)';
	assert.deepEqual(topFrames(stack, 2), ['at handler (src/index.ts:10:5)', 'at y (src/lib/z.ts:2:1)']);
	assert.deepEqual(topFrames(null), []);
});
