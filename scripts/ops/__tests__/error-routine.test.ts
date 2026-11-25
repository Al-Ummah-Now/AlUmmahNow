import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, dueRelease, hasFindings, issueBody, LABEL, publish, TITLE, type Baseline, type ReleaseRun } from '../error-routine.ts';
import type { ErrorSummary } from '../public-report.ts';

const A = { id: 'eg_aaaaaaaaaaaaaaaa', line: 'web caught Error /:locale/video/:id status – count 4', test: false };
const B = { id: 'eg_bbbbbbbbbbbbbbbb', line: 'api-videos http other /api/videos status 500 count 1', test: false };
const now = (over: Partial<ErrorSummary> = {}): ErrorSummary => ({ groups: [A], actions: { 'api-videos processing video': 2 }, ...over });
const base: Baseline = { v: 1, known: [A.id], actions: { 'api-videos processing video': 2 } };

test('the first run only writes the baseline', () => {
	const { findings, next } = compare(null, now());
	assert.equal(hasFindings(findings), false);
	assert.deepEqual(next, base);
});

test('a first run that cannot read every part writes no baseline', () => {
	for (const s of [now({ groups: null }), now({ actions: null })]) {
		const { findings, next } = compare(null, s);
		assert.equal(hasFindings(findings), false);
		assert.equal(next, null);
	}
});

test('the same errors again, more of them, fewer items or a test group: nothing new', () => {
	for (const s of [now(), now({ groups: [{ ...A, line: A.line.replace('4', '400') }] }), now({ actions: {} }), now({ groups: [A, { ...B, test: true }] })]) {
		assert.equal(hasFindings(compare(base, s).findings), false);
	}
});

test('a new group, a new kind of item and more items of a kind are found once', () => {
	const s = now({ groups: [A, B], actions: { 'api-videos processing video': 3, 'processor queue quran-sync': 1 } });
	const { findings, next } = compare(base, s);
	assert.deepEqual(findings.groups, [B]);
	assert.deepEqual(findings.actions, [{ kind: 'api-videos processing video', before: 2, now: 3 }, { kind: 'processor queue quran-sync', before: 0, now: 1 }]);
	assert.equal(hasFindings(compare(next!, s).findings), false);
});

test('a group that was quiet for a while is not new; an unreadable report forgets nothing', () => {
	const { next } = compare(base, now({ groups: [] }));
	assert.equal(hasFindings(compare(next, now()).findings), false);
	const broken = compare(base, { groups: null, actions: null });
	assert.equal(hasFindings(broken.findings), false);
	assert.deepEqual(broken.next, base);
});

test('a production release is due once, 45 minutes to a day after it ended', () => {
	const t = Date.parse('2026-11-25T20:44:05Z');
	const run = (over: Partial<ReleaseRun> = {}): ReleaseRun => ({ id: 9, event: 'push', conclusion: 'success', head_branch: 'v2026.11.25.9', updated_at: '2026-11-25T20:44:05Z', repository: { id: 1 }, head_repository: { id: 1 }, ...over });
	const min = 60_000;
	assert.equal(dueRelease([run()], undefined, t + 44 * min), null);
	assert.equal(dueRelease([run()], undefined, t + 45 * min), '9');
	assert.equal(dueRelease([run()], '8', t + 24 * 60 * min), '9');
	assert.equal(dueRelease([run()], '9', t + 60 * min), null, 'already checked');
	assert.equal(dueRelease([run()], undefined, t + 25 * 60 * min), null, 'the daily check has seen it');
	// A newer release resets the wait; an older one is not checked instead
	const newer = run({ id: 10, updated_at: '2026-11-25T21:20:00Z' });
	assert.equal(dueRelease([run(), newer], undefined, t + 60 * min), null);
	assert.equal(dueRelease([run(), newer], undefined, t + 90 * min), '10');
	// A stage-only dispatch, a failed or cancelled release, another branch, a fork: never
	for (const over of [{ event: 'workflow_dispatch' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: null }, { head_branch: 'main' }, { head_branch: 'verify' }, { head_branch: null }, { head_repository: { id: 2 } }, { head_repository: null }, { repository: undefined, head_repository: undefined }, { updated_at: 'x' }]) {
		assert.equal(dueRelease([run(over)], undefined, t + 60 * min), null, JSON.stringify(over));
	}
	assert.equal(dueRelease([], undefined, t), null);
});

test('the checked release is carried from run to run', () => {
	assert.equal(compare({ ...base, release: '9' }, now()).next?.release, '9');
	assert.equal('release' in compare(base, now()).next!, false);
});

test('one issue: opened, then commented on while it is open', async () => {
	const { findings } = compare(base, now({ groups: [B] }));
	const calls: string[] = [];
	const gh = (open: unknown[]) => async (path: string, init?: RequestInit) => {
		calls.push(`${init?.method ?? 'GET'} ${path}`);
		if (init?.method === 'POST' && path === '/issues') assert.deepEqual(JSON.parse(String(init.body)).labels, [LABEL]);
		return Response.json(open);
	};
	assert.equal(await publish(findings, 'https://run', gh([{ number: 5, pull_request: {} }])), 'opened');
	assert.equal(await publish(findings, 'https://run', gh([{ number: 7 }])), 'updated');
	assert.deepEqual(calls.filter((c) => c.startsWith('POST')), ['POST /issues', 'POST /issues/7/comments']);
	assert.match(issueBody(findings, 'https://run'), /eg_bbbbbbbbbbbbbbbb` api-videos http/);
	assert.doesNotMatch(TITLE, /\d/);
});
