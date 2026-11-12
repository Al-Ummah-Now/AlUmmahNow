import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscodeJobMessage } from '@al-ummah/shared-types';
import { ATTEMPT_LIMIT_MS, containerSeconds, keyAllowed, MAX_ATTEMPTS, newJob, onFailure, onMessage, SILENCE_LIMIT_MS, watchdogVerdict } from '../src/jobs';

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
		assert.equal(onMessage(job, msg()), 'duplicate');
		assert.equal(onMessage(job, msg({ jobId: 'job-2' })), 'supersede');
		assert.equal(onMessage({ ...job, status: 'ready' }, msg({ jobId: 'job-2' })), 'start');
	});
	it('retries with growing delays, never past the attempt limit, never on fatal errors', () => {
		const job = newJob(msg(), 0);
		assert.deepEqual(onFailure(job, 'x', false), { retry: true, delaySeconds: 60 });
		assert.deepEqual(onFailure({ ...job, attempt: 2 }, 'x', false), { retry: true, delaySeconds: 240 });
		assert.deepEqual(onFailure({ ...job, attempt: MAX_ATTEMPTS }, 'x', false), { retry: false });
		assert.deepEqual(onFailure(job, 'source_missing', true), { retry: false });
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
