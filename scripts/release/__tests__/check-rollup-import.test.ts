import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { STUCK_AFTER_MS, evaluateImport, targets } from '../check-rollup-import.ts';

const now = Date.UTC(2026, 10, 9);
const at = (ms: number) => new Date(now - ms).toISOString();

test('only old documents the import never took fail the check', () => {
	const report = evaluateImport(
		[
			{ key: 'analytics/rollups/video/a/2026-10.json', lastModified: at(STUCK_AFTER_MS + 1) }, // stuck
			{ key: 'analytics/rollups/video/b/2026-11.json', lastModified: at(60_000) }, // still being written
			{ key: 'analytics/rollups/video/c/2026-09.json', lastModified: at(STUCK_AFTER_MS * 2) }, // imported, delete failing
			{ key: 'analytics/rollups/video/d/2026-11.json', lastModified: at(3_600_000) }, // imported moments ago
		],
		new Set(['analytics/rollups/video/c/2026-09.json', 'analytics/rollups/video/d/2026-11.json']),
		now,
	);
	assert.deepEqual(report.stuck, ['analytics/rollups/video/a/2026-10.json']);
	assert.deepEqual(report.undeleted, ['analytics/rollups/video/c/2026-09.json']);
	assert.equal(report.pending, 1);
	assert.equal(report.remaining, 4);
	assert.equal(report.ok, false);
});

test('nothing left means done', () => {
	assert.equal(evaluateImport([], new Set(), now).ok, true);
});

test('reads the messages bucket and notifications database of each environment', () => {
	const root = join(import.meta.dirname, '..', '..', '..');
	assert.equal(targets(root, 'production').bucket, 'al-ummah-now-messages');
	assert.equal(targets(root, 'stage').bucket, 'al-ummah-now-messages-stage');
	assert.equal(targets(root, 'qa').bucket, 'al-ummah-now-messages-qa');
	for (const env of ['qa', 'stage', 'production'] as const) assert.match(targets(root, env).databaseId, /^[0-9a-f-]{36}$/);
});
