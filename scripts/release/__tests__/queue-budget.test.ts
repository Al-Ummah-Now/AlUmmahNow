import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget, parseArgs, queueNames } from '../queue-budget.ts';

describe('queue budget', () => {
	it('names each environment\'s queues', () => {
		assert.deepEqual(queueNames('production'), { videos: 'al-ummah-now-videos', dlq: 'al-ummah-now-dlq' });
		assert.deepEqual(queueNames('qa'), { videos: 'al-ummah-now-videos-qa', dlq: 'al-ummah-now-dlq-qa' });
		assert.deepEqual(queueNames('stage'), { videos: 'al-ummah-now-videos-stage', dlq: 'al-ummah-now-dlq-stage' });
	});

	it('passes under budget with an empty DLQ', () => {
		const r = evaluateBudget({ windowMinutes: 60, videosWrites: 6000, dlqWrites: 0, maxWritesPerMinute: 600, maxDlqWrites: 0 });
		assert.equal(r.ok, true);
		assert.equal(r.writesPerMinute, 100);
	});

	it('fails on the QA flood (79k writes in an hour) and on any dead letter', () => {
		const flood = evaluateBudget({ windowMinutes: 60, videosWrites: 79178, dlqWrites: 0, maxWritesPerMinute: 600, maxDlqWrites: 0 });
		assert.equal(flood.ok, false);
		assert.match(flood.problems[0]!, /1319\.6 writes\/min/);
		const dlq = evaluateBudget({ windowMinutes: 60, videosWrites: 10, dlqWrites: 30, maxWritesPerMinute: 600, maxDlqWrites: 0 });
		assert.equal(dlq.ok, false);
		assert.match(dlq.problems[0]!, /30 message\(s\) dead-lettered/);
	});

	it('parses the window from --since or --minutes', () => {
		const now = Date.parse('2026-11-08T21:00:00Z');
		const a = parseArgs(['--env', 'qa', '--since', '2026-11-08T20:30:00Z'], now);
		assert.equal(a.from.toISOString(), '2026-11-08T20:30:00.000Z');
		assert.equal(a.maxWritesPerMinute, 600);
		assert.equal(a.maxDlqWrites, 0);
		const b = parseArgs(['--minutes', '15', '--max-writes-per-minute', '50'], now);
		assert.equal(b.env, 'qa');
		assert.equal(b.from.toISOString(), '2026-11-08T20:45:00.000Z');
		assert.equal(b.maxWritesPerMinute, 50);
		assert.throws(() => parseArgs(['--env', 'prod'], now), /--env/);
		assert.throws(() => parseArgs(['--since', '2026-11-09T00:00:00Z'], now), /window/);
	});
});
