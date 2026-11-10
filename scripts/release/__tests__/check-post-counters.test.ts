import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { STUCK_AFTER_MS, evaluatePostCounters, targets } from '../check-post-counters.ts';

const now = Date.UTC(2026, 10, 9);
const at = (ms: number) => new Date(now - ms).toISOString();

test('a stalled import and a total that disagrees with R2 fail the check', () => {
	const report = evaluatePostCounters(
		[
			{ post_id: 'a', kind: 'likes', done: 0, updated_at: at(STUCK_AFTER_MS + 1) }, // stuck
			{ post_id: 'b', kind: 'votes', done: 0, updated_at: at(60_000) }, // moving now
			{ post_id: 'c', kind: 'likes', done: 1, updated_at: at(STUCK_AFTER_MS * 5) },
		],
		[
			{ postId: 'c', kind: 'likes', counted: 12, records: 12 },
			{ postId: 'd', kind: 'votes', counted: 9, records: 10 },
		],
		now,
	);
	assert.deepEqual(report.stuck, ['likes:a']);
	assert.deepEqual(report.mismatched.map((s) => s.postId), ['d']);
	assert.equal(report.done, 1);
	assert.equal(report.ok, false);
});

test('everything moved and matching is ok', () => {
	assert.equal(evaluatePostCounters([], [{ postId: 'x', kind: 'likes', counted: 3, records: 3 }], now).ok, true);
});

test('reads the community posts bucket and notifications database of each environment', () => {
	const root = join(import.meta.dirname, '..', '..', '..');
	for (const env of ['qa', 'stage', 'production'] as const) {
		assert.ok(targets(root, env).bucket);
		assert.match(targets(root, env).databaseId, /^[0-9a-f-]{36}$/);
	}
});
