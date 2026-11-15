/**
 * The admin's troubleshooting panel (videos admin → Delivery): what the Transcoder keeps about
 * failed starts, its job view, a cancelled job's stand-in, and the internal routes' guards.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cancelledJob, jobView, MAX_ATTEMPTS, newJob, onMessage, SOURCE_WAIT_ATTEMPTS, START_MAX_DELIVERIES, startFailureNote } from '../src/jobs';
import { handleInternalJob } from '../src/internal-jobs';

const VIDEO = '912859ed-e618-4d04-8438-874a74a251dd';
const JOB = '0f4a1c2e-1111-4222-8333-444455556666';
const REV = '0123456789abcdef';
const T = Date.parse('2026-11-15T03:00:00Z');
const msg = { kind: 'transcode' as const, videoId: VIDEO, jobId: JOB, rev: REV, access: 'pub' as const, queuedAt: new Date(T - 600_000).toISOString(), reason: 'upload' as const };

describe('failed starts (noteStartFailure)', () => {
	it('keeps delivery n of max, the plain reason, the scrubbed error and when the queue sends it again', () => {
		const note = startFailureNote(JOB, 'The container just exited https://x.b-cdn.net/a?token=abc', 2, T);
		assert.equal(note.deliveries, 2);
		assert.equal(note.maxDeliveries, START_MAX_DELIVERIES);
		assert.equal(note.reason, 'container start failed');
		assert.equal(note.error.includes('token=abc'), false);
		assert.equal(note.nextRetryAt, new Date(T + 30_000).toISOString());
	});
	it('has no next try on the last delivery', () => {
		assert.equal(startFailureNote(JOB, 'There is no Container instance available at this time', START_MAX_DELIVERIES, T).nextRetryAt, null);
	});
});

describe('job view', () => {
	it('gives times as ISO, the next retry only while waiting, and max attempts for the error', () => {
		const job = { ...newJob(msg, T), status: 'waiting_retry' as const, nextRetryAt: T + 60_000, error: 'container_stopped' };
		const view = jobView(job);
		assert.equal(view.nextRetryAt, new Date(T + 60_000).toISOString());
		assert.equal(view.maxAttempts, MAX_ATTEMPTS);
		assert.equal(view.attemptStartedAt, new Date(T).toISOString());
		assert.equal(jobView({ ...job, status: 'running' }).nextRetryAt, null);
		assert.equal(jobView({ ...job, error: 'source_unavailable' }).maxAttempts, SOURCE_WAIT_ATTEMPTS);
	});
});

describe('cancel', () => {
	it('a stand-in makes a later delivery of the same job a duplicate, and a new job starts', () => {
		const stub = cancelledJob(msg, T);
		assert.equal(stub.status, 'cancelled');
		assert.equal(onMessage(stub, msg, T + 3600_000), 'duplicate');
		assert.equal(onMessage(stub, { ...msg, jobId: '0f4a1c2e-9999-4222-8333-444455556666' }, T), 'start');
	});
});

describe('internal job routes', () => {
	const calls: string[] = [];
	const stub = {
		jobState: async () => null,
		troubleshootState: async () => ({ job: null, startFailure: null, durableObjectId: 'abc' }),
		retryNow: async (id: string) => (calls.push(`retry:${id}`), 'started'),
		cancelJob: async (input: { jobId: string }) => (calls.push(`cancel:${input.jobId}`), 'cancelled'),
	};
	const env = { INTERNAL_API_KEY: 'k', TRANSCODER: { idFromName: (n: string) => n, get: () => stub } } as never;
	const req = (method: string, body?: unknown, key = 'k') => new Request('https://media.internal/x', { method, headers: { 'X-API-Key': key, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

	it('needs the internal key and a video id', async () => {
		assert.equal((await handleInternalJob(req('GET', undefined, 'nope'), env, VIDEO)).status, 401);
		assert.equal((await handleInternalJob(req('GET'), env, 'bad id!')).status, 400);
	});
	it('reads the troubleshooting state', async () => {
		const res = await handleInternalJob(req('GET'), env, VIDEO);
		assert.deepEqual(await res.json(), { job: null, view: null, startFailure: null, durableObjectId: 'abc' });
	});
	it('retry-now and cancel check their body', async () => {
		assert.equal((await handleInternalJob(req('POST', { jobId: 'x' }), env, VIDEO, 'retry-now')).status, 400);
		assert.deepEqual(await (await handleInternalJob(req('POST', { jobId: JOB }), env, VIDEO, 'retry-now')).json(), { outcome: 'started' });
		assert.equal((await handleInternalJob(req('POST', { jobId: JOB }), env, VIDEO, 'cancel')).status, 400);
		assert.deepEqual(await (await handleInternalJob(req('POST', { jobId: JOB, rev: REV, access: 'priv', queuedAt: msg.queuedAt }), env, VIDEO, 'cancel')).json(), { outcome: 'cancelled' });
		assert.deepEqual(calls, [`retry:${JOB}`, `cancel:${JOB}`]);
	});
});
