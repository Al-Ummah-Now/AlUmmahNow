import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLines, pathLines } from '../prod-errors.ts';
import { leftOutLine, messageTemplate, placeLog, restrictedPath, restrictedText, unrestricted } from '../restricted.ts';

const ID = '9a66ebfa-a5c7-47d1-a2ac-2708ce3d6d4a';
let n = 0;
const line = (message: string, source: object = {}, url?: string, requestId = `r${n++}`) => ({
	timestamp: 1_800_000_000_000,
	source: { level: 'error', message, ...source },
	$metadata: { message, level: 'error' },
	$workers: { requestId, ...(url ? { event: { request: { method: 'GET', url: `https://x.example${url}` }, response: { status: 500 } } } : {}) },
});

/** One per tag, path, source file and word: none may be in the report. SECRET is in every one of them. */
const RESTRICTED = [
	...['[CSAM]', '[ChildSafety]', '[SafetyMail]', '[ReportRetention]', '[GuestReport]', '[csam]'].map((t) => line(`${t} SECRET`, {}, '/api/x')),
	line('[2026-11-25T10:00:00Z] [SafetyMail] SECRET', {}, '/api/x'),
	...['/api/csam', `/api/csam/${ID}/hold`, '/internal/csam/x', '/internal/guest-reports', '/webhooks/cloudflare/notifications', '/moderation/csam', `/en/moderation/csam/${ID}`, '/ar/moderation/csam'].map((p) => line('[Api] SECRET', {}, p)),
	line('[Api] slow SECRET request GET /internal/guest-reports 200', {}, '/x'),
	line('[Api] SECRET', { path: '/internal/guest-reports' }, '/x'),
	line('[Api] SECRET', { url: `https://x.example/webhooks/cloudflare/notifications?a=1` }, '/x'),
	...['src/lib/moderation/childSafety.ts:1:2', 'src/lib/moderation/safetyMail.ts', 'apps/admin-api/src/lib/moderation/retention.ts:4', 'src/lib/moderation/takedown.ts', 'src/endpoints/moderation/GuestReportSubmit.ts:9', 'src/lib/guest-report-limits.ts', 'src/lib/csam/contain.ts', 'src/routers/csam.router.ts'].map((f) => line('[Api] SECRET', { stack: `Error: SECRET\n    at f (${f})` }, '/x')),
	line('[Api] SECRET', { module: 'lib/moderation/takedown' }, '/x'),
	line('[Api] D1_ERROR: no such table: csam_cases SECRET', {}, '/x'),
	line('[Api] SECRET', { deep: { list: [{ child_safety: 1 }] } }, '/x'),
	line('[Api] SECRET', { kind: 'Child Safety' }, '/x'),
	line('csam SECRET'),
];

test('every restricted line is left out of both listings, and counted', () => {
	const ordinary = line('[Media] Job failed', { videoId: ID, stage: 'probe' }, '/internal/media/events');
	const logs = logLines([...RESTRICTED, ordinary]);
	assert.equal(logs.leftOut, RESTRICTED.length);
	assert.equal(logs.error, 1, 'nor counted as errors in the public part');
	assert.doesNotMatch(logs.lines.join('\n'), /SECRET|csam|child.?safety|guest-report|SafetyMail|Retention|takedown/i);
	const paths = pathLines([...RESTRICTED, ordinary], ['/']);
	assert.doesNotMatch(paths.lines.join('\n'), /SECRET|csam|child.?safety|guest-report|SafetyMail|Retention|takedown/i);
	assert.ok(paths.leftOut >= RESTRICTED.length - 1);
	assert.match(paths.lines.join('\n'), /Job failed/);
});

test('everything else keeps its fields, ids and extra', () => {
	const text = logLines([line('[Media] Job failed', { videoId: ID, stage: 'probe', caseId: 'c1' }, '/internal/media/events')]).lines.join('\n');
	for (const part of [ID, 'probe', 'caseId', '/internal/media/events']) assert.ok(text.includes(part), part);
	for (const path of ['/report', '/en/report', '/api/report', '/api/moderation/reports', '/api/review/1', '/moderation/ai', '/moderation/reports/1', '/webhooks/cloudflare', '/webhooks/cloudflare/other', '/api/csamples']) assert.equal(restrictedPath(path), path === '/api/csamples', path);
});

test('a line of a restricted request goes even when it says nothing itself', () => {
	const logs = logLines([line('[Api] SECRET', {}, '/api/csam/1', 'same'), line('[Api] plain', {}, undefined, 'same'), line('[Api] other', {}, undefined, 'else')]);
	assert.equal(logs.leftOut, 2);
	assert.match(logs.lines.join('\n'), /other/);
	assert.doesNotMatch(logs.lines.join('\n'), /plain/);
	// The line that names the area may be an info line
	const info = line('[Api] SECRET', {}, '/api/csam/1', 'q');
	info.source.level = info.$metadata.level = 'info';
	assert.equal(logLines([info, line('[Api] plain', {}, undefined, 'q')]).leftOut, 1);
});

test('a line with neither tag nor path prints only the template of its message', () => {
	const text = logLines([line(`Job ${ID} of "A title" for a@b.example failed 3 times at https://x.example/v/1 with Some detail`, { videoId: ID, other: 'field' })]).lines.join('\n');
	assert.match(text, /Job # of … for … failed # times at … with Some detail/);
	assert.doesNotMatch(text, /9a66ebfa|title|example|field/);
	assert.equal(messageTemplate(undefined), '');
	assert.equal(placeLog(line('[Media] x'), ''), 'full');
	assert.equal(placeLog(line('x', {}, '/y'), '/y'), 'full');
	assert.equal(placeLog(line('x'), ''), 'template');
});

test('groups and items: any key or value of these areas, their latest sample included', () => {
	const rows = [{ row: { id: 'eg_1', message: 'R2TranscodeFailed', name: 'x' }, ev: { extra: JSON.stringify({ videoId: ID }) } }, { row: { id: 'eg_2', message: 'x' }, ev: { stack: 'at f (src/lib/moderation/takedown.ts:1)' } }, { row: { id: 'eg_3', route: '/internal/guest-reports' }, ev: null }, { row: { id: 'eg_4', message: 'x', alert: 'child-safety-mail' }, ev: undefined }, { row: { id: 'eg_5' }, ev: { extra: '{"key":"csam:1"}' } }];
	const { rows: kept, leftOut } = unrestricted(rows);
	assert.deepEqual([kept.map((r) => r.row.id), leftOut], [['eg_1'], 4]);
	assert.equal(restrictedText({ title: 'Email not sent', detail: '[SafetyMail] x' }), true);
});

test('the count is numbers only', () => {
	assert.equal(leftOutLine({ lines: 3, groups: 1, items: 0 }), '3 restricted lines, 1 restricted groups, 0 restricted items left out');
	assert.equal(leftOutLine({ lines: 0, groups: null, items: null }), '0 restricted lines, unknown restricted groups, unknown restricted items left out');
});

test('matching stays linear on long text', () => {
	const started = Date.now();
	for (const text of ['/a'.repeat(200_000), '['.repeat(200_000), '"'.repeat(200_000), 'child '.repeat(100_000), '/'.repeat(200_000)]) {
		restrictedText(text);
		messageTemplate(text);
	}
	assert.ok(Date.now() - started < 3000);
});
