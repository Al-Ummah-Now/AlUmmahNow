import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicErrors, publicMedia, publicRoute } from '../public-report.ts';

/** A value for every field that must not come through, in every field. */
const NASTY = [
	'usr_0123456789abcdef0123456789abcdef', 'alice@example.com', 'alice%40example.com', '@SomePerson', '%D8%B4%D8%AE%D8%B5', 'SomePersonError', '12345678-9abc-4def-8123-456789abcdef', '203.0.113.7', '::1',
	'A private lesson', '{"title":"A \\"private\\" lesson"}', '/en/@SomePerson', '/en/c/SomePerson', '/ar/@%D8%B4/videos', '/api/users/usr_01/channels', 'C:\\Users\\alice\\a.mp4', '\\\\nas\\share', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIi', 'token=abc',
	'web\nalice', '- eg_0123456789abcdef web', 'eg_0123456789abcdef alice', '2026-11-25T13:36 alice', '<script>alert(1)</script>', '[x](https://evil.example)', '__proto__', 'constructor', '::set-output name=x::y',
	12.5, -1, 1e30, NaN, null, undefined, true, {}, [], { toString: () => 'alice' },
];
const LINE = [
	/^$/,
	/^# (Errors|Media diagnostics): (production|stage|qa|other), (\d{4}-\d\d-\d\dT\d\d:\d\dZ|–) to (\d{4}-\d\d-\d\dT\d\d:\d\dZ|–)$/,
	/^## (Error groups|Open needs-action items|Cost collector|Logs \(events\))$/,
	/^\d+ (groups|open|failed runs)$/,
	/^(not readable|– failed runs)$/,
	/^- (eg_[0-9a-f]{16}|–) [a-z-]+ [a-z]+ [A-Za-z0-9]+ (–|(\/(:other|:id|:locale|[a-z-]+))+) status (\d{3}|–) count (\d+|–) first (\d{4}-\d\d-\d\dT\d\d:\d\dZ|–) last (\d{4}-\d\d-\d\dT\d\d:\d\dZ|–)( test)?$/,
	/^- [a-z-]+ [a-z-]+ [a-z-]+ count \d+$/,
	/^- (logs )?[a-z-]+ (warn (\d+|–) error (\d+|–)|not readable)$/,
	/^- (deployments read|transcode queue backlog|transcode dead letters|container applications) (\d+|–|not readable)$/,
	/^- transcode starts (\(30 days\) \d+, p50 \d+ ms, p95 \d+ ms|not readable)$/,
];
const LEAK = /alice|SomePerson|private|lesson|usr_|%D8|شخص|@|12345678|203\.0|::|\\|eyJ|token|script|evil|proto|constructor|undefined|NaN|object/i;

function check(lines: string[]): void {
	for (const line of lines) {
		assert.ok(LINE.some((l) => l.test(line)), `not on the allow list: ${JSON.stringify(line)}`);
		assert.doesNotMatch(line, LEAK);
	}
}

test('a nasty fixture prints nothing but the allow list', () => {
	const date = new Date('2026-11-25T13:44:35.658Z');
	for (const x of NASTY) {
		const v = x as never;
		check(
			publicErrors({
				env: v,
				since: date,
				until: v,
				groups: [{ id: v, app: v, kind: v, name: v, route: v, status: v, http_status: v, occurrences: v, first_seen: v, last_seen: v, test: 0, message: v, culprit: v } as never],
				actions: [{ app: v, source: v, item_type: v, updated_at: v, title: v, detail: v, item_id: v } as never],
				collectorFailures: v,
				logs: [{ app: v, warn: v, error: v, readable: true }, { app: v, warn: 0, error: 0, readable: false }],
			}),
		);
		const n = typeof x === 'number' ? x : 0;
		check(publicMedia({ env: v, since: v, until: date, deployments: Number.isFinite(n) && n >= 0 ? Math.min(n, 1e6) : null, backlog: { queue: 3, dlq: null }, containers: 1, starts: null, logs: [{ app: v, warn: v, error: v, readable: true }] }));
	}
});

test('what triage needs is printed', () => {
	const lines = publicErrors({
		env: 'production',
		since: new Date('2026-11-22T13:44:35Z'),
		until: new Date('2026-11-25T13:44:35Z'),
		groups: [{ id: 'eg_705a58bdb8ca3d25', app: 'api-videos', kind: 'http', name: null, route: '/api/watch-history/:id/progress', http_status: 500, occurrences: 192, first_seen: '2026-11-12T00:56:48.254Z', last_seen: '2026-11-25T08:07:00.390Z', test: 1 }],
		actions: [{ app: 'api-videos', source: 'processing', item_type: 'video' }, { app: 'api-videos', source: 'processing', item_type: 'video' }],
		collectorFailures: 0,
		logs: [{ app: 'web', warn: 3, error: 1, readable: true }],
	});
	assert.ok(lines.includes('- eg_705a58bdb8ca3d25 api-videos http other /api/watch-history/:id/progress status 500 count 192 first 2026-11-12T00:56Z last 2026-11-25T08:07Z test'));
	assert.ok(lines.includes('- api-videos processing video count 2'));
	assert.ok(lines.includes('- web warn 3 error 1'));
	check(lines);
});

test('a route is known words and params only', () => {
	assert.equal(publicRoute('/:locale/video/:id'), '/:locale/video/:id');
	assert.equal(publicRoute('/en/@SomePerson/videos'), '/:other/:other/videos');
	assert.equal(publicRoute('/api/channels/:handle'), '/api/channels/:other');
	assert.equal(publicRoute('not a route'), '–');
});

test('the scripts print the public part only, and a pull request reads stage only without an artifact', () => {
	for (const f of ['prod-errors', 'media-diagnostics']) {
		const src = readFileSync(new URL(`../${f}.ts`, import.meta.url), 'utf8');
		assert.doesNotMatch(src, /console\.\w+\(/, f);
		assert.deepEqual([...src.matchAll(/process\.stdout\.write\((\w+)/g)].map((m) => m[1]), [f === 'prod-errors' ? 'publicErrors' : 'publicMedia'], f);
		assert.deepEqual([...src.matchAll(/process\.stderr\.write\((.)/g)].map((m) => m[1]), ["'"], f);
		assert.equal(src.match(/writeFileSync\(sealedPath, JSON\.stringify\(seal\(/g)?.length, 2, f);
		assert.equal(src.match(/writeFileSync\(/g)?.length, 2, f);
		const yml = readFileSync(new URL(`../../../.github/workflows/${f}.yml`, import.meta.url), 'utf8');
		const steps = yml.split(/\n      - /).slice(1);
		for (const step of steps.filter((x) => x.includes('secrets.'))) {
			const pr = step.includes("github.event_name == 'pull_request'");
			assert.ok(pr || step.includes("if: github.event_name == 'workflow_dispatch'"), step);
			if (pr) assert.ok(/--env stage /.test(step) && !/sealed|production|inputs\./.test(step), step);
		}
		const upload = steps.find((x) => x.includes('upload-artifact'))!;
		assert.ok(upload.includes("github.event_name == 'workflow_dispatch'") && upload.includes('path: report.sealed.json'), f);
	}
});
