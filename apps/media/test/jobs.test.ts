import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscodeJobMessage } from '@al-ummah/shared-types';
import { ATTEMPT_LIMIT_MS, containerSeconds, hasWatchdogDue, INFRA_RETRY_LIMIT, isInfraFailure, keyAllowed, SELFTEST_MAX_DAY_RUNS, SELFTEST_MAX_RUNS, SELFTEST_MIN_GAP_MS, selfTestDue, selfTestRuns, START_MAX_DELIVERIES, startFailureReason, startRetry, LAUNCH_LIMIT_MS, launchLost, MAX_ATTEMPTS, newJob, onFailure, onMessage, onProgressEvent, PROGRESS_REPORT_MS, SILENCE_LIMIT_MS, watchdogVerdict } from '../src/jobs';

const msg = (over: Partial<TranscodeJobMessage> = {}): TranscodeJobMessage => ({
	kind: 'transcode',
	videoId: '0b3c2a1e-1111-2222-3333-444455556666',
	jobId: 'job-1',
	rev: 'abcdefgh12345678',
	access: 'pub',
	queuedAt: '2026-11-11T00:00:00.000Z',
	reason: 'upload',
	...over,
});

describe('job decisions', () => {
	it('builds the prefix from access, video and rev', () => {
		assert.equal(newJob(msg({ access: 'priv' }), 0).prefix, 'priv/0b3c2a1e-1111-2222-3333-444455556666/abcdefgh12345678');
	});
	it('treats a redelivered message as a duplicate and a new job as superseding a running one', () => {
		const job = newJob(msg(), 0);
		assert.equal(onMessage(undefined, msg()), 'start');
		assert.equal(onMessage(job, msg(), 60_000), 'duplicate');
		assert.equal(onMessage(job, msg({ jobId: 'job-2' })), 'supersede');
		assert.equal(onMessage({ ...job, status: 'ready' }, msg({ jobId: 'job-2' })), 'start');
		assert.equal(onMessage({ ...job, status: 'stopping' }, msg({ jobId: 'job-2' })), 'supersede');
	});
	it('starts a redelivered job again when its launch was lost (restart mid-start), never a live one', () => {
		const job = newJob(msg(), 0);
		const late = LAUNCH_LIMIT_MS + 1;
		// The consumer died mid-launch (a deploy): saved as running, no container ever answered
		assert.equal(launchLost(job, late), true);
		assert.equal(onMessage(job, msg(), late), 'relaunch');
		// Still inside the launch window: a plain duplicate
		assert.equal(onMessage(job, msg(), LAUNCH_LIMIT_MS - 1), 'duplicate');
		// Launched, or reporting in (jobs saved before launchedAt existed): a duplicate, never restarted
		assert.equal(onMessage({ ...job, launchedAt: 1000 }, msg(), late), 'duplicate');
		assert.equal(onMessage({ ...job, lastSeenAt: late - 1000 }, msg(), late), 'duplicate');
		// Only a running attempt can have lost its launch
		assert.equal(onMessage({ ...job, status: 'waiting_retry' }, msg(), late), 'duplicate');
		assert.equal(onMessage({ ...job, status: 'ready' }, msg(), late), 'duplicate');
	});
	it('retries with growing delays, never past the attempt limit, never on fatal errors', () => {
		const job = newJob(msg(), 0);
		assert.deepEqual(onFailure(job, 'x', false), { retry: true, delaySeconds: 60 });
		assert.deepEqual(onFailure({ ...job, attempt: 2 }, 'x', false), { retry: true, delaySeconds: 240 });
		assert.deepEqual(onFailure({ ...job, attempt: MAX_ATTEMPTS }, 'x', false), { retry: false });
		assert.deepEqual(onFailure(job, 'source_missing', true), { retry: false });
		// No source yet (Bunny still encoding its MP4 fallback): wait in 5-minute steps, up to an hour
		assert.deepEqual(onFailure({ ...job, attempt: 5 }, 'source_unavailable', false), { retry: true, delaySeconds: 300 });
		assert.deepEqual(onFailure({ ...job, attempt: 12 }, 'source_unavailable', false), { retry: true, delaySeconds: 300 });
		assert.deepEqual(onFailure({ ...job, attempt: 24 }, 'source_unavailable', false), { retry: false });
	});
	it('counts container seconds across attempts', () => {
		const job = { ...newJob(msg(), 1000), priorSeconds: 30 };
		assert.equal(containerSeconds(job, 61_000), 90);
		assert.equal(containerSeconds({ ...job, status: 'ready' }, 61_000), 30);
	});
});

describe('watchdog', () => {
	const job = newJob(msg(), 0);
	it('completes from /status when the ready event was lost', () => {
		const result = { rungs: [] } as never;
		assert.deepEqual(watchdogVerdict(job, { status: 'ready', jobId: 'job-1', result }, 60_000), { kind: 'ready', result });
	});
	it('fails a restarted (idle) container, a silent one and an endless attempt', () => {
		assert.equal(watchdogVerdict(job, { status: 'idle' }, 3 * 60_000).kind, 'failed');
		assert.equal(watchdogVerdict(job, { status: 'idle' }, 30_000).kind, 'ok');
		assert.equal(watchdogVerdict(job, null, SILENCE_LIMIT_MS + 1).kind, 'failed');
		assert.equal(watchdogVerdict({ ...job, lastSeenAt: ATTEMPT_LIMIT_MS }, { status: 'transcoding', jobId: 'job-1' }, ATTEMPT_LIMIT_MS + 1).kind, 'failed');
		assert.equal(watchdogVerdict(job, { status: 'transcoding', jobId: 'job-1' }, 60_000).kind, 'ok');
	});
	it('retries a launch that no container took (restart mid-start) after the launch limit, not the silence limit', () => {
		const late = LAUNCH_LIMIT_MS + 1;
		assert.deepEqual(watchdogVerdict(job, null, late), { kind: 'failed', error: 'launch_lost', fatal: false });
		assert.equal(watchdogVerdict(job, null, LAUNCH_LIMIT_MS - 1).kind, 'ok');
		// The container has the job: launched, whatever launchedAt says
		assert.equal(watchdogVerdict(job, { status: 'transcoding', jobId: 'job-1' }, late).kind, 'ok');
		// Launched and quiet for less than the silence limit: fine
		assert.equal(watchdogVerdict({ ...job, launchedAt: 1 }, null, late).kind, 'ok');
		assert.ok(LAUNCH_LIMIT_MS < SILENCE_LIMIT_MS);
	});
});

describe('keyAllowed', () => {
	const prefix = 'pub/vid-12345678/abcdefgh12345678';
	it('allows files and one level of rendition folders under the job prefix only', () => {
		assert.ok(keyAllowed(prefix, `${prefix}/master.m3u8`));
		assert.ok(keyAllowed(prefix, `${prefix}/720p/seg_00001.m4s`));
		assert.ok(!keyAllowed(prefix, `${prefix}/../other/x`));
		assert.ok(!keyAllowed(prefix, `${prefix}/a/b/c`));
		assert.ok(!keyAllowed(prefix, 'pub/vid-12345678/otherrev0000000/master.m3u8'));
		assert.ok(!keyAllowed(prefix, `${prefix}x/master.m3u8`));
	});
});

describe('progress reports to api-videos', () => {
	const enc = (p: number) => ['360p', '720p'].map((name) => ({ name, state: 'encoding', progress: p }));

	it('passes the rung states through, validated', () => {
		const job = newJob(msg(), 0);
		const step = onProgressEvent(job, { progress: 0.3, rungs: [...enc(0.3), { name: '<script>', state: 'done' }, { name: '480p', state: 'bogus' }] }, undefined, 1000);
		assert.deepEqual(step.report, { type: 'progress', progress: 0.3, rungs: enc(0.3) });
		assert.deepEqual(job.rungs, enc(0.3));
		assert.equal(job.progress, 0.3);
		assert.deepEqual(step.last, { at: 1000, states: '360p:encoding,720p:encoding' });
	});

	it('reports at most every 10 s while only the % moves', () => {
		const job = newJob(msg(), 0);
		const first = onProgressEvent(job, { progress: 0.1, rungs: enc(0.1) }, undefined, 1000);
		assert.ok(first.report);
		const soon = onProgressEvent(job, { progress: 0.2, rungs: enc(0.2) }, first.last, 1000 + PROGRESS_REPORT_MS - 1);
		assert.equal(soon.report, null);
		assert.equal(job.progress, 0.2, 'the job still keeps the latest figure');
		assert.ok(onProgressEvent(job, { progress: 0.3, rungs: enc(0.3) }, first.last, 1000 + PROGRESS_REPORT_MS).report);
	});

	it('reports a rung state change at once', () => {
		const job = newJob(msg(), 0);
		const first = onProgressEvent(job, { progress: 0.99, rungs: enc(0.99) }, undefined, 1000);
		const step = onProgressEvent(job, { progress: 0.99, rungs: [{ name: '360p', state: 'uploading', progress: 0.1 }, { name: '720p', state: 'pending' }] }, first.last, 1001);
		assert.deepEqual(step.report?.rungs, [{ name: '360p', state: 'uploading', progress: 0.1 }, { name: '720p', state: 'pending' }]);
	});

	it('an event without rungs (an older container) still reports the %', () => {
		const job = newJob(msg(), 0);
		assert.deepEqual(onProgressEvent(job, { progress: 0.5 }, undefined, 1).report, { type: 'progress', progress: 0.5 });
	});
});

describe('review media (docs/specs/VIDEO-REVIEW.md §5)', () => {
	const base = { kind: 'transcode' as const, videoId: 'v1', jobId: 'j1', rev: 'abcdefgh12345678', access: 'priv' as const, queuedAt: 'x', reason: 'upload' as const };
	it('a job that asks for review media gets its own review/<videoId>/<rev>/ prefix', () => {
		const job = newJob({ ...base, review: { frameIntervalSeconds: 2, sceneThreshold: 0.3, maxFrames: 1200 } }, 0);
		assert.equal(job.reviewPrefix, 'review/v1/abcdefgh12345678/');
		assert.deepEqual(job.review, { frameIntervalSeconds: 2, sceneThreshold: 0.3, maxFrames: 1200 });
	});
	it('a job without it extracts nothing', () => {
		const job = newJob(base, 0);
		assert.equal(job.reviewPrefix, undefined);
		assert.equal(job.review, undefined);
	});
});

describe('hasWatchdogDue', () => {
	const sqlWith = (n: number | Error) => ({
		exec: (query: string, ...binds: unknown[]) => {
			if (n instanceof Error) throw n;
			assert.match(query, /container_schedules/);
			assert.equal(binds[0], 1000);
			return { toArray: () => [{ n }] };
		},
	});
	it('sees a later watchdog run, so the launch does not start a second chain', () => {
		assert.equal(hasWatchdogDue(sqlWith(1) as never, 1_000_000), true);
		assert.equal(hasWatchdogDue(sqlWith(0) as never, 1_000_000), false);
	});
	it('counts an unreadable schedule table as none (one spare run beats an unwatched job)', () => {
		assert.equal(hasWatchdogDue(sqlWith(new Error('no such table')) as never, 1_000_000), false);
	});
});

describe('start retries (a job that could not start)', () => {
	it('comes back within seconds, not minutes: the 2026-11-15 jobs waited 240 s after the fixed image rolled out', () => {
		assert.deepEqual(startRetry(1), { giveUp: false, delaySeconds: 15 });
		assert.deepEqual(startRetry(2), { giveUp: false, delaySeconds: 30 });
		assert.deepEqual(startRetry(3), { giveUp: false, delaySeconds: 60 });
		for (let a = 1; a < START_MAX_DELIVERIES; a++) {
			const r = startRetry(a);
			assert.ok(!r.giveUp && r.delaySeconds <= 300, `delivery ${a} waits at most 5 min`);
		}
	});
	it('gives up (and is reported) on the last delivery the queue makes, instead of falling into the DLQ', () => {
		assert.equal(START_MAX_DELIVERIES, 9, 'wrangler max_retries 8 + the first delivery');
		assert.deepEqual(startRetry(START_MAX_DELIVERIES), { giveUp: true });
		let total = 0;
		for (let a = 1; a < START_MAX_DELIVERIES; a++) total += (startRetry(a) as { delaySeconds: number }).delaySeconds;
		assert.ok(total <= 30 * 60, `a job that cannot start is reported within 30 min (was ~78), got ${total} s`);
	});
	it('names the cause in plain words', () => {
		assert.equal(startFailureReason('The container just exited'), 'container start failed');
		assert.equal(startFailureReason('Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?'), 'container start failed');
		assert.equal(startFailureReason('The container is not running, consider calling start()'), 'container start failed');
		assert.equal(startFailureReason('There is no Container instance available at this time'), 'capacity full');
		assert.equal(startFailureReason('container refused the job: HTTP 409'), 'container refused the job');
	});
});

describe('platform failures do not use up attempts', () => {
	const job = newJob(msg(), 0);
	it('a deploy SIGTERM, a lost launch or a restarted container retries in 15 s and keeps the attempt', () => {
		assert.equal(isInfraFailure('container_stopped', 143), true);
		assert.equal(isInfraFailure('launch_lost'), true);
		assert.equal(isInfraFailure('container_restarted'), true);
		assert.deepEqual(onFailure({ ...job, attempt: MAX_ATTEMPTS }, 'container_stopped', false, true), { retry: true, delaySeconds: 15, keepsAttempt: true });
	});
	it('a real crash (OOM 137, ffmpeg) counts, and so do platform failures past the limit', () => {
		assert.equal(isInfraFailure('container_stopped', 137), false);
		assert.equal(isInfraFailure('ffmpeg exited 1'), false);
		assert.deepEqual(onFailure({ ...job, attempt: MAX_ATTEMPTS, infraRetries: INFRA_RETRY_LIMIT }, 'launch_lost', false, true), { retry: false });
		assert.deepEqual(onFailure({ ...job, infraRetries: INFRA_RETRY_LIMIT }, 'launch_lost', false, true), { retry: true, delaySeconds: 60 });
	});
});

describe('container self-test (release smoke)', () => {
	const at = (ms: number) => new Date(ms).toISOString();
	const T = Date.parse('2026-11-15T03:00:00Z');
	const run = (ok: boolean, ago: number, version: string | undefined, runs = 1, dayRuns = 1) => ({ ok, startMs: 1, at: at(T - ago), version, runs, day: at(T - ago).slice(0, 10), dayRuns });
	it('starts one for a new deploy (no run yet, or the last run is from another version)', () => {
		assert.equal(selfTestDue(undefined, T, 'v2'), true);
		assert.equal(selfTestDue(run(true, SELFTEST_MIN_GAP_MS, 'v1'), T, 'v2'), true);
		assert.deepEqual(selfTestRuns(run(false, 10_000, 'v1', 7, 4), 'v2', T), { runs: 1, day: '2026-11-15', dayRuns: 5 });
	});
	it('reuses a pass for the same version, however often it is asked (the route is public)', () => {
		assert.equal(selfTestDue(run(true, 10_000, 'v2'), T, 'v2'), false);
		assert.equal(selfTestDue(run(true, 3600_000, 'v2'), T, 'v2'), false);
	});
	it('reruns a failure at most SELFTEST_MAX_RUNS times per version', () => {
		assert.equal(selfTestDue(run(false, SELFTEST_MIN_GAP_MS, 'v2'), T, 'v2'), true);
		assert.equal(selfTestRuns(run(false, SELFTEST_MIN_GAP_MS, 'v2', 3), 'v2', T).runs, 4);
		assert.equal(selfTestDue(run(false, 3600_000, 'v2', SELFTEST_MAX_RUNS), T, 'v2'), false);
	});
	it('keeps one minute between any two starts and a daily cap, even when the version keeps changing', () => {
		assert.equal(selfTestDue(run(false, 10_000, 'v2'), T, 'v2'), false);
		assert.equal(selfTestDue(run(true, 10_000, 'v1'), T, 'v2'), false);
		assert.equal(selfTestDue(run(true, 3600_000, 'v1', 1, SELFTEST_MAX_DAY_RUNS), T, 'v2'), false);
		// the next UTC day starts a fresh count
		assert.equal(selfTestRuns(run(true, 4 * 3600_000, 'v1', 1, SELFTEST_MAX_DAY_RUNS), 'v2', T).dayRuns, 1);
	});
});
