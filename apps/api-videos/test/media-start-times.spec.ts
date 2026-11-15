/**
 * Transcode start times (TranscodeStartup): what api-videos keeps from the Transcoder's 'started'
 * events, what it writes to media_jobs, and the Delivery panel's p50/p95 (cold vs warm).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStartup } from '@al-ummah/shared-types';
import { percentileMs, readStartTimes, startTimeStats, type StartTimeRow } from '../src/lib/media/start-times';

const row = (ms: number | null, cold: 0 | 1, ready = 900, dispatch: number | null = 2000): StartTimeRow => ({ ms, start_cold: cold, start_ready_ms: ready, start_dispatch_ms: dispatch });

describe('startup reports from the transcoder', () => {
	it('keeps a well-formed report and rounds its times', () => {
		assert.deepEqual(sanitizeStartup({ cold: true, readyMs: 812.6, acceptMs: 1004, dispatchMs: 3100, ffmpegMs: 6200 }), { cold: true, readyMs: 813, acceptMs: 1004, dispatchMs: 3100, ffmpegMs: 6200 });
		assert.deepEqual(sanitizeStartup({ cold: false, readyMs: 3, acceptMs: 40 }), { cold: false, readyMs: 3, acceptMs: 40 });
	});
	it('drops malformed ones and impossible numbers', () => {
		for (const bad of [null, {}, { cold: 'yes', readyMs: 1, acceptMs: 2 }, { cold: true, readyMs: -1, acceptMs: 2 }, { cold: true, readyMs: 1 }, { cold: true, readyMs: 1, acceptMs: 1e12 }]) {
			assert.equal(sanitizeStartup(bad), null, JSON.stringify(bad));
		}
		assert.deepEqual(sanitizeStartup({ cold: true, readyMs: 1, acceptMs: 2, ffmpegMs: 'soon' }), { cold: true, readyMs: 1, acceptMs: 2 });
	});
});

describe('start time statistics', () => {
	it('nearest-rank percentiles', () => {
		assert.equal(percentileMs([], 50), null);
		assert.equal(percentileMs([4000, 1000, 3000, 2000], 50), 2000);
		assert.equal(percentileMs([4000, 1000, 3000, 2000], 95), 4000);
	});
	it('p50/p95 overall and per cold and warm start, ready and dispatch medians, NULLs left out', () => {
		const s = startTimeStats([row(6000, 1, 1200), row(8000, 1, 1500), row(30000, 1, 2000, null), row(400, 0, 5), row(600, 0, 8), row(null, 1)]);
		assert.equal(s.samples, 5);
		assert.equal(s.p50Ms, 6000);
		assert.equal(s.p95Ms, 30000);
		assert.deepEqual(s.cold, { samples: 3, p50Ms: 8000, p95Ms: 30000 });
		assert.deepEqual(s.warm, { samples: 2, p50Ms: 400, p95Ms: 600 });
		assert.equal(s.coldReadyP50Ms, 1500);
		assert.equal(s.dispatchP50Ms, 2000, 'the NULL dispatch is not a 0');
	});
	it('no data: zero samples and no numbers', () => {
		const s = startTimeStats([]);
		assert.deepEqual([s.samples, s.p50Ms, s.cold.p50Ms, s.warm.p50Ms, s.dispatchP50Ms], [0, null, null, null, null]);
	});
	it('reads the last 7 days from media_jobs, bounded', async () => {
		let sql = '';
		let bound: unknown[] = [];
		const db = { prepare: (q: string) => ({ bind: (...b: unknown[]) => ((sql = q), (bound = b), { all: async () => ({ results: [row(5000, 1)] }) }) }) } as unknown as D1Database;
		const T = Date.parse('2026-11-15T12:00:00Z');
		const s = await readStartTimes(db, T);
		assert.equal(s?.p50Ms, 5000);
		assert.match(sql, /FROM media_jobs WHERE queued_at >= \?1 AND start_accept_ms IS NOT NULL ORDER BY queued_at DESC LIMIT 500/);
		assert.deepEqual(bound, [new Date(T - 7 * 86_400_000).toISOString()]);
		assert.equal(await readStartTimes(undefined, T), null);
	});
});
