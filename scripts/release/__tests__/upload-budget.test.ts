import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASES, formatReport, likeMatcher, likePrefix, parseArgs, toSnapshot, uploadDelta } from '../upload-budget.ts';

const DAY = 1794268800;

test('a run\'s uploads are the counter growth since the baseline; a restarted day window counts in full', () => {
	const before = toSnapshot([
		{ user_id: 'a', operation: 'video_upload_session', window_start: DAY, count: 100 },
		{ user_id: 'a', operation: 'video_upload_continue', window_start: DAY, count: 7 },
		{ user_id: 'b', operation: 'video_upload_session', window_start: DAY - 86400, count: 50 },
	]);
	const after = toSnapshot([
		{ user_id: 'a', operation: 'video_upload_session', window_start: DAY, count: 104 },
		{ user_id: 'a', operation: 'video_upload_continue', window_start: DAY, count: 7 },
		{ user_id: 'b', operation: 'video_upload_session', window_start: DAY, count: 3 },
		{ user_id: 'c', operation: 'video_upload_session', window_start: DAY, count: 2 },
		{ user_id: 'c', operation: 'category_suggest', window_start: DAY, count: 9 },
	]);
	const delta = uploadDelta(after, before);
	assert.equal(delta.sessions, 4 + 3 + 2);
	assert.equal(delta.continues, 0);
	assert.equal(delta.users, 3);
	assert.deepEqual(delta.byUser.map((u) => u.userId), ['a', 'b', 'c']);
});

test('without a baseline every counted upload is this run\'s (fresh release users)', () => {
	const delta = uploadDelta(toSnapshot([{ user_id: 'r', operation: 'video_upload_session', window_start: DAY, count: 5 }]));
	assert.equal(delta.sessions, 5);
	assert.match(formatReport('%-g1a1-%', 'qa', delta, 40)[0], /5 upload session\(s\).*budget 40/);
});

test('arguments: qa or stage only (never production), a safe LIKE pattern, an integer budget', () => {
	assert.deepEqual(Object.keys(DATABASES).sort(), ['qa', 'stage']);
	assert.equal(parseArgs(['--env', 'stage', '--emails', 'test-%-1795000000001@e2e.alummahnow.net']).env, 'stage');
	assert.throws(() => parseArgs(['--env', 'production', '--emails', 'x%']), /qa or stage/);
	assert.throws(() => parseArgs(['--emails', "x' OR 1=1 --"]), /LIKE pattern/);
	assert.throws(() => parseArgs(['--emails', 'rel-%', '--max', '-1']), /non-negative/);
	assert.equal(parseArgs(['--emails', '%-g9a1-%', '--max', '40']).max, 40);
});

test('a run pattern longer than D1\'s 50-byte LIKE limit is a prefix range plus an exact match', () => {
	const pattern = 'e2e+43116467775-1-web-chromium-%@e2e.alummahnow.net';
	assert.ok(pattern.length > 50, 'D1 refused this pattern: "LIKE or GLOB pattern too complex"');
	assert.equal(likePrefix(pattern), 'e2e+43116467775-1-web-chromium-');
	const matches = likeMatcher(pattern);
	assert.equal(matches('e2e+43116467775-1-web-chromium-single@e2e.alummahnow.net'), true);
	assert.equal(matches('E2E+43116467775-1-web-chromium-single@E2E.alummahnow.net'), true, 'LIKE is case-insensitive');
	assert.equal(matches('e2e+43116467775-1-web-chromium-single@e2eXalummahnow.net'), false, '. is literal');
	assert.equal(matches('e2e+43116467775-1-web-chromium-a@e2e.alummahnow.net.x'), false, 'anchored');
	assert.equal(likeMatcher('a_c')('abc'), true);
});
