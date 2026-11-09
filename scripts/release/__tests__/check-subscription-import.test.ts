import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { STUCK_AFTER_MS, evaluateSubscriptionImport, targets } from '../check-subscription-import.ts';

const now = Date.UTC(2026, 10, 9);
const at = (ms: number) => new Date(now - ms).toISOString();

test('only channels the import should long have reached fail the check', () => {
	const report = evaluateSubscriptionImport(
		[
			{ key: 'a', lastModified: at(STUCK_AFTER_MS + 1) }, // stuck
			{ key: 'b', lastModified: at(60_000) }, // new channel, next pass takes it
			{ key: 'c', lastModified: at(STUCK_AFTER_MS * 3) }, // imported
		],
		new Set(['c']),
		[],
		now,
	);
	assert.deepEqual(report.stuck, ['a']);
	assert.equal(report.pending, 1);
	assert.equal(report.imported, 1);
	assert.equal(report.ok, false);
});

test('a count that disagrees with its rows fails the check', () => {
	const report = evaluateSubscriptionImport([{ key: 'c', lastModified: at(0) }], new Set(['c']), ['c'], now);
	assert.equal(report.ok, false);
});

test('everything imported and consistent passes', () => {
	assert.equal(evaluateSubscriptionImport([{ key: 'c', lastModified: at(0) }], new Set(['c']), [], now).ok, true);
});

test('reads the channels bucket and notifications database of each environment', () => {
	const root = join(import.meta.dirname, '..', '..', '..');
	assert.equal(targets(root, 'production').bucket, 'channels');
	assert.equal(targets(root, 'stage').bucket, 'channels-stage');
	assert.equal(targets(root, 'qa').bucket, 'channels-qa');
	for (const env of ['qa', 'stage', 'production'] as const) assert.match(targets(root, env).databaseId, /^[0-9a-f-]{36}$/);
});
