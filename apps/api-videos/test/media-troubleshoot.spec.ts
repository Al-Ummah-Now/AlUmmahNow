/**
 * R2 transcode troubleshooting (videos admin → Delivery): the error mapping and job states, the
 * per-job view with and without the media Worker, Retry now / Cancel and the stall rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncOwnership, STALL_QUEUED_MS, STALL_RUNNING_MS, transcodeErrorReason, transcodeStall, troubleshootState, scrubOpsText, type TranscoderJobView } from '@al-ummah/shared-types';
import { cancelTranscode, flagStalledTranscodes, readTroubleshootJobs, retryTranscodeNow, stallIsNew, stallNotice, toTroubleshootJob, actionFailedNotice } from '../src/lib/media/troubleshoot';
import { createMediaInternalRouter } from '../src/endpoints/media/mediaInternal';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const JOB = '0f4a1c2e-1111-4222-8333-444455556666';
const REV = '0123456789abcdef';
const T = Date.parse('2026-11-15T03:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const view = (over: Partial<TranscoderJobView> = {}): TranscoderJobView => ({
	jobId: JOB,
	status: 'running',
	attempt: 1,
	maxAttempts: 3,
	attemptStartedAt: iso(T - 60_000),
	launchedAt: iso(T - 50_000),
	lastSeenAt: iso(T - 10_000),
	nextRetryAt: null,
	progress: 0.4,
	error: null,
	...over,
});

describe('raw errors → plain reasons', () => {
	it('maps the 2026-11-15 container crash, capacity and the watchdog verdicts', () => {
		assert.equal(transcodeErrorReason('The container just exited'), 'container_start_failed');
		assert.equal(transcodeErrorReason('Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?'), 'container_start_failed');
		assert.equal(transcodeErrorReason('The container is not running, consider calling start()'), 'container_start_failed');
		assert.equal(transcodeErrorReason('container start failed: Container exited (code: 1)'), 'container_start_failed');
		assert.equal(transcodeErrorReason('There is no Container instance available at this time'), 'capacity_full');
		assert.equal(transcodeErrorReason('capacity full: max_instances reached'), 'capacity_full');
		assert.equal(transcodeErrorReason('source_unavailable'), 'source_not_ready');
		assert.equal(transcodeErrorReason('source_missing'), 'source_missing');
		for (const code of ['launch_lost', 'container_stopped', 'container_restarted', 'attempt_timeout', 'container_silent', 'no_video_stream', 'cancelled'] as const) {
			assert.equal(transcodeErrorReason(code), code);
		}
		assert.equal(transcodeErrorReason('container refused the job: HTTP 409 busy'), 'container_refused');
		assert.equal(transcodeErrorReason('ffmpeg exited with code 1'), 'encode_failed');
		assert.equal(transcodeErrorReason('something odd'), 'unknown');
		assert.equal(transcodeErrorReason(''), null);
	});
	it('scrubs signed URLs and credentials from text that leaves the server', () => {
		const out = scrubOpsText('GET https://vz.b-cdn.net/x/original?token=abc&expires=1 Bearer eyJabc.def Authorization: secret123 "api_key":"k"');
		assert.equal(/token=abc|secret123|"k"/.test(out), false);
		assert.ok(out.includes('https://vz.b-cdn.net/x/original?…'));
		assert.equal(scrubOpsText('see "http://a?x=1" and https://b/c'), 'see "http://a?…" and https://b/c');
	});
	it('stays linear on hostile log text (CodeQL polynomial ReDoS)', () => {
		const t0 = performance.now();
		scrubOpsText('http://'.repeat(50_000));
		transcodeErrorReason('put '.repeat(50_000));
		assert.ok(performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms`);
		assert.equal(transcodeErrorReason('PUT pub/v/r/360p.m3u8 failed: 503'), 'upload_failed');
	});
});

describe('job state', () => {
	const row = { status: 'queued', job_id: JOB };
	it('a job whose starts fail is waiting for the queue to send it again', () => {
		const start = { jobId: JOB, deliveries: 3, maxDeliveries: 9, reason: 'container start failed', error: 'The container just exited', at: iso(T), nextRetryAt: iso(T + 60_000) };
		assert.equal(troubleshootState(row, null, start), 'start_retry');
		const job = toTroubleshootJob({ video_id: ID, job_id: JOB, status: 'queued', attempts: 0, queued_at: iso(T - 600_000), started_at: null, failed_at: null, error: null, updated_at: iso(T) }, 'A title', { view: null, startFailure: start, durableObjectId: 'do-1' }, true);
		assert.equal(job.state, 'start_retry');
		assert.equal(job.attempt, 3);
		assert.equal(job.maxAttempts, 9);
		assert.equal(job.nextRetryAt, iso(T + 60_000));
		assert.equal(job.reason, 'container_start_failed');
		assert.deepEqual(job.instance, { name: ID, durableObjectId: 'do-1', state: null });
	});
	it('running, waiting to retry, failed and cancelled come from the transcoder and the record', () => {
		assert.equal(troubleshootState(row, view(), null), 'running');
		assert.equal(troubleshootState(row, view({ status: 'waiting_retry' }), null), 'waiting_retry');
		assert.equal(troubleshootState({ status: 'failed', job_id: JOB }, null, null), 'failed');
		assert.equal(troubleshootState({ status: 'cancelled', job_id: JOB }, null, null), 'cancelled');
		// an older job on the transcoder says nothing about this one
		assert.equal(troubleshootState(row, view({ jobId: 'other-job-id-1234' }), null), 'queued');
	});
	it('a failed job says what its source is, without the hash; anything malformed is nothing', () => {
		const facts = { bytes: 10, container: 'mp4', zeroStartPercent: 0, zeroEndPercent: 0, sha256: 'a'.repeat(64), streams: [{ kind: 'audio', codec: 'aac' }] };
		const of = (source_facts: string | null, status = 'failed') => toTroubleshootJob({ video_id: ID, job_id: JOB, status, attempts: 1, queued_at: iso(T), started_at: iso(T), failed_at: iso(T), error: 'no_video_stream', updated_at: iso(T), source_facts }, null, null, false).source;
		const { sha256, ...rest } = facts;
		assert.deepEqual(of(JSON.stringify(facts)), rest);
		assert.ok(!JSON.stringify(of(JSON.stringify(facts))).includes(sha256));
		for (const bad of [null, '{', '{}', JSON.stringify({ ...facts, sha256: 'x' })]) assert.equal(of(bad), null);
		assert.equal(of(JSON.stringify(facts), 'cancelled'), null);
	});
	it('marks the transcoder as unavailable when it was asked and did not answer', () => {
		const job = toTroubleshootJob({ video_id: ID, job_id: JOB, status: 'transcoding', attempts: 1, queued_at: iso(T), started_at: iso(T), failed_at: null, error: null, updated_at: iso(T) }, null, null, true);
		assert.equal(job.transcoderUnavailable, true);
		assert.equal(job.state, 'running');
	});
});

describe('stall rules', () => {
	const row = (over = {}) => ({ status: 'transcoding', job_id: JOB, queued_at: iso(T - 3600_000), ...over });
	it('no progress for 10 minutes while running', () => {
		assert.equal(transcodeStall(row(), view({ lastSeenAt: iso(T - STALL_RUNNING_MS + 1000) }), T), null);
		assert.deepEqual(transcodeStall(row(), view({ lastSeenAt: iso(T - 12 * 60_000) }), T), { kind: 'no_progress', minutes: 12 });
	});
	it('a retry more than 5 minutes late', () => {
		assert.equal(transcodeStall(row(), view({ status: 'waiting_retry', nextRetryAt: iso(T - 60_000) }), T), null);
		assert.deepEqual(transcodeStall(row(), view({ status: 'waiting_retry', nextRetryAt: iso(T - 7 * 60_000) }), T), { kind: 'retry_late', minutes: 7 });
	});
	it('waiting more than 30 minutes for its first start', () => {
		assert.equal(transcodeStall(row({ status: 'queued', queued_at: iso(T - STALL_QUEUED_MS + 1000) }), null, T), null);
		assert.deepEqual(transcodeStall(row({ status: 'queued', queued_at: iso(T - 31 * 60_000) }), null, T), { kind: 'queued_too_long', minutes: 31 });
		assert.equal(transcodeStall(row({ status: 'ready' }), null, T), null);
	});
	it('a job waiting for a slot (every slot of the admin limit busy) is not stalled', () => {
		assert.equal(transcodeStall(row({ status: 'queued', queued_at: iso(T - 90 * 60_000) }), null, T, { slotsFull: true }), null);
		// A running job without word is still stalled when the slots are full
		assert.deepEqual(transcodeStall(row(), view({ lastSeenAt: iso(T - 12 * 60_000) }), T, { slotsFull: true }), { kind: 'no_progress', minutes: 12 });
	});
	it('is reported by the first sweep that sees it only', () => {
		assert.equal(stallIsNew({ kind: 'no_progress', minutes: 12 }), true);
		assert.equal(stallIsNew({ kind: 'no_progress', minutes: 21 }), false);
		assert.equal(stallIsNew({ kind: 'queued_too_long', minutes: 39 }), true);
		assert.equal(stallIsNew({ kind: 'queued_too_long', minutes: 41 }), false);
	});
	it('uses the job key (resolved when it is ready) and Retry now', () => {
		const n = stallNotice(ID, JOB, { kind: 'retry_late', minutes: 7 }, 'container_stopped');
		assert.equal(n.key, `media-transcode:${ID}`);
		assert.deepEqual(n.retry, { kind: 'service', service: 'api-videos', path: '/internal/media/troubleshoot/retry-now', body: { videoId: ID } });
		const f = actionFailedNotice({ id: 'job-123456789', kind: 'media.transcode-cancel', targetId: ID }, 'cancel HTTP 500');
		assert.equal(f.retry.path, '/internal/media/troubleshoot/jobs/retry');
	});
});

/** A fake media Worker: GET state, POST cancel / retry-now. */
function mediaWorker(state: { view: TranscoderJobView | null; startFailure?: unknown }, calls: string[] = [], fail = false) {
	return {
		async fetch(input: string, init?: RequestInit) {
			const path = new URL(input).pathname;
			calls.push(`${init?.method ?? 'GET'} ${path}`);
			if (fail) return new Response('boom', { status: 500 });
			if (path.endsWith('/cancel')) return Response.json({ outcome: 'cancelled' });
			if (path.endsWith('/retry-now')) return Response.json({ outcome: 'started' });
			return Response.json({ job: null, view: state.view, startFailure: state.startFailure ?? null, durableObjectId: 'do-1' });
		},
	};
}

function setup(r2: Record<string, unknown> | null, worker?: ReturnType<typeof mediaWorker>) {
	const db = new SqliteD1();
	const queuedAt = iso(T - 35 * 60_000);
	if (r2) {
		db.db
			.prepare('INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, error, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
			.run(ID, JOB, String(r2.status), 'pub', queuedAt, (r2.error as string) ?? null, queuedAt);
	}
	const videos = new MemoryBucket({ [ID]: videoFixture({ id: ID, ...(r2 ? { r2: { jobId: JOB, rev: REV, access: 'pub', attempts: 0, queuedAt, ...r2 } } : {}) }) });
	const queue = new MemoryQueue();
	const env = { videos, SEARCH_DB: db, TRANSCODE_QUEUE: queue, INTERNAL_API_KEY: 'k', ...(worker ? { MEDIA_WORKER: worker } : {}) };
	return { env: env as never, videos, queue, db };
}

describe('readTroubleshootJobs', () => {
	it('works with no media Worker (local stack): our own record only', async () => {
		const { env } = setup({ status: 'queued' });
		const out = await readTroubleshootJobs(env, T);
		assert.equal(out.transcoder, 'unbound');
		assert.equal(out.items.length, 1);
		assert.equal(out.items[0]!.state, 'queued');
		assert.equal(out.items[0]!.transcoderUnavailable, undefined);
	});
	it('asks the transcoder for active jobs and lists failed ones with their reason', async () => {
		const calls: string[] = [];
		const { env, db } = setup({ status: 'transcoding' }, mediaWorker({ view: view({ status: 'waiting_retry', nextRetryAt: iso(T + 60_000), error: 'container_stopped', attempt: 2 }) }, calls));
		db.db.prepare('INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, error, updated_at) VALUES (?, ?, ?, ?, 3, ?, ?, ?)').run('a1b2c3d4-0000-4000-8000-000000000001', 'job-failed-0001', 'failed', 'pub', iso(T - 3600_000), 'source_missing', iso(T - 600_000));
		await syncOwnership(db as never, 'video', 'a1b2c3d4-0000-4000-8000-000000000001', videoFixture({ id: 'a1b2c3d4-0000-4000-8000-000000000001' }) as never);
		const out = await readTroubleshootJobs(env, T);
		assert.equal(out.transcoder, 'ok');
		assert.deepEqual(calls, [`GET /internal/jobs/${ID}`]);
		assert.equal(out.items[0]!.state, 'waiting_retry');
		assert.equal(out.items[0]!.attempt, 2);
		assert.equal(out.items[0]!.reason, 'container_stopped');
		assert.equal(out.items[1]!.state, 'failed');
		assert.equal(out.items[1]!.reason, 'source_missing');
	});
	it('says the transcoder failed when no active job could be asked', async () => {
		const { env } = setup({ status: 'queued' }, mediaWorker({ view: null }, [], true));
		const out = await readTroubleshootJobs(env, T);
		assert.equal(out.transcoder, 'error');
		assert.equal(out.items[0]!.transcoderUnavailable, true);
	});
});

describe('Retry now', () => {
	it('runs a waiting retry at once', async () => {
		const calls: string[] = [];
		const { env } = setup({ status: 'transcoding' }, mediaWorker({ view: view({ status: 'waiting_retry' }) }, calls));
		assert.equal(await retryTranscodeNow(env, ID), 'retry_started');
		assert.ok(calls.includes(`POST /internal/jobs/${ID}/retry-now`));
	});
	it('sends a job that never started again under the same job id', async () => {
		const { env, queue } = setup({ status: 'queued' }, mediaWorker({ view: null }));
		assert.equal(await retryTranscodeNow(env, ID), 'resent');
		const sent = queue.messages[0] as { jobId: string; rev: string };
		assert.equal(sent.jobId, JOB);
		assert.equal(sent.rev, REV);
	});
	it('leaves a running job alone and throws when the transcoder cannot be asked (the admin job retries)', async () => {
		assert.equal(await retryTranscodeNow(setup({ status: 'transcoding' }, mediaWorker({ view: view() })).env, ID), 'running');
		await assert.rejects(retryTranscodeNow(setup({ status: 'queued' }, mediaWorker({ view: null }, [], true)).env, ID));
	});
});

describe('Cancel', () => {
	it('stops the job on the transcoder, then marks the record cancelled (the sweep never re-queues it)', async () => {
		const calls: string[] = [];
		const { env, videos, db } = setup({ status: 'transcoding' }, mediaWorker({ view: view() }, calls));
		assert.equal(await cancelTranscode(env, undefined, ID, 'usr_admin'), 'cancelled');
		assert.ok(calls.includes(`POST /internal/jobs/${ID}/cancel`));
		const saved = JSON.parse(String(videos.store.get(ID)));
		assert.equal(saved.r2.status, 'cancelled');
		assert.equal(saved.r2.cancelledBy, 'usr_admin');
		const row = await db.prepare('SELECT status FROM media_jobs WHERE video_id = ?').bind(ID).first<{ status: string }>();
		assert.equal(row?.status, 'cancelled');
		// again: nothing to do
		assert.equal(await cancelTranscode(env, undefined, ID, 'usr_admin'), 'cancelled');
	});
	it('does nothing to a finished job and throws on a transcoder error', async () => {
		assert.equal(await cancelTranscode(setup({ status: 'ready' }, mediaWorker({ view: null })).env, undefined, ID, 'a'), 'already_finished');
		await assert.rejects(cancelTranscode(setup({ status: 'queued' }, mediaWorker({ view: null }, [], true)).env, undefined, ID, 'a'));
	});
});

describe('flagStalledTranscodes', () => {
	it('reports a job waiting too long for its first start, once', async () => {
		const posts: unknown[] = [];
		const { env } = setup({ status: 'queued' }, mediaWorker({ view: null }));
		const real = globalThis.fetch;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			posts.push(JSON.parse(String(init?.body)));
			return new Response('{}');
		}) as never;
		try {
			const e = { ...(env as object), ERRORS_INGEST_URL: 'https://admin.test/internal/errors' } as never;
			const out = await flagStalledTranscodes(e, { waitUntil: () => undefined }, T);
			assert.equal(out.flagged, 1);
			await new Promise((r) => setTimeout(r, 10));
			const action = (posts[0] as { events: { action: { key: string } }[] }).events[0]!.action;
			assert.equal(action.key, `media-transcode:${ID}`);
			// ten minutes later the same stall is not reported again
			assert.equal((await flagStalledTranscodes(e, undefined, T + 11 * 60_000)).flagged, 0);
		} finally {
			globalThis.fetch = real;
		}
	});
});

describe('internal routes', () => {
	it('lists jobs and queues the actions as admin jobs', async () => {
		const { env } = setup({ status: 'queued' });
		const sent: unknown[] = [];
		const db = (env as { SEARCH_DB: SqliteD1 }).SEARCH_DB;
		const e = { ...(env as object), ADMIN_JOBS_QUEUE: { send: async (m: unknown) => void sent.push(m) } } as never;
		const app = createMediaInternalRouter();
		const list = await app.request('/troubleshoot', {}, e);
		assert.equal(((await list.json()) as { result: { items: unknown[] } }).result.items.length, 1);
		const bad = await app.request('/troubleshoot/actions', { method: 'POST', body: JSON.stringify({ action: 'delete', videoId: ID, actorId: 'a' }) }, e);
		assert.equal(bad.status, 400);
		const res = await app.request('/troubleshoot/actions', { method: 'POST', body: JSON.stringify({ action: 'cancel', videoId: ID, actorId: 'usr_admin' }) }, e);
		assert.equal(res.status, 202);
		const row = await db.prepare('SELECT kind, target_id, actor_id FROM admin_jobs').first<{ kind: string; target_id: string; actor_id: string }>();
		assert.deepEqual({ ...row }, { kind: 'media.transcode-cancel', target_id: ID, actor_id: 'usr_admin' });
		assert.equal(sent.length, 1);
	});
});
