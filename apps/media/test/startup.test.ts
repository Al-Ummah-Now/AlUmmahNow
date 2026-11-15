/** Startup timing of a transcode attempt (TranscodeStartup), as the Transcoder records it. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startupTimes } from '../src/jobs';

const T = Date.parse('2026-11-15T12:00:00Z');
const job = { queuedAt: new Date(T - 3_000).toISOString(), attempt: 1 };

describe('startupTimes', () => {
	it('first attempt: dispatch (queued → began), container ready, job accepted; cold or warm as seen', () => {
		assert.deepEqual(startupTimes(job, true, T, T + 850, T + 920, true), { cold: true, readyMs: 850, acceptMs: 920, dispatchMs: 3000 });
		assert.deepEqual(startupTimes(job, false, T, T + 4, T + 30, true), { cold: false, readyMs: 4, acceptMs: 30, dispatchMs: 3000 });
	});
	it('a retry has no dispatch time (it waited on purpose), and clocks never go negative', () => {
		assert.deepEqual(startupTimes(job, true, T, T - 5, T - 1, false), { cold: true, readyMs: 0, acceptMs: 0 });
	});
});
