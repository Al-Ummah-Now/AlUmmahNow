/**
 * R2 transcode troubleshooting (videos admin → Delivery → "Transcode troubleshooting"; owner,
 * 2026-11-14: "why the logs are not on admin to troubleshoot?").
 *
 * - readTroubleshootJobs: queued, running, waiting and recently failed or cancelled jobs, each with
 *   what the video's Transcoder (apps/media, MEDIA_WORKER binding) says: attempt n of max, the next
 *   try, the last error and its plain reason.
 * - retryTranscodeNow / cancelTranscode: the admin actions (run by the admin-jobs queue,
 *   lib/admin/service.ts kinds media.transcode-retry and media.transcode-cancel).
 * - flagStalledTranscodes: the 10-minute sweep's stall rules (shared-types transcodeStall) → an
 *   Errors page item under the job's own key, media-transcode:<videoId>, resolved when it is ready.
 *
 * The Containers API, queue analytics and logs are read by admin-api with the admin-set token
 * (apps/admin-api/src/lib/media-troubleshoot/); nothing here talks to the Cloudflare API.
 */
import {
	reportNeedsAction,
	resolveNeedsAction,
	sanitizeSourceFacts,
	scrubOpsText,
	STALL_QUEUED_MS,
	STALL_RETRY_LATE_MS,
	STALL_RUNNING_MS,
	transcodeErrorReason,
	transcodeStall,
	troubleshootState,
	type ErrorReporterEnv,
	type ExecutionContextLike,
	type TranscodeJobMessage,
	type TranscodeStall,
	type TranscodeStartFailure,
	type TranscoderJobView,
	type TroubleshootJob,
	type TroubleshootJobs,
	type TroubleshootSource,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { enqueueTranscode, pushMediaLive, recordJob, transcodeSlotsFull, type MediaEnv, type MediaVideo } from './r2-delivery';

type SecretLike = string | { get(): Promise<string> };

export interface TroubleshootEnv extends MediaEnv {
	/** apps/media (al-ummah-now-media[-env]); unbound in the local stack */
	MEDIA_WORKER?: { fetch(input: string, init?: RequestInit): Promise<Response> };
	INTERNAL_API_KEY?: SecretLike;
}

/** What GET /internal/jobs/:videoId on apps/media answers. */
export interface TranscoderAnswer {
	view: TranscoderJobView | null;
	startFailure: TranscodeStartFailure | null;
	durableObjectId: string | null;
}

/** Active jobs looked at per read (each is one call to the media Worker). */
export const ACTIVE_LIMIT = 30;
/** Finished jobs (failed, cancelled) listed, newest first, from the last few days. */
export const FINISHED_LIMIT = 20;
const FINISHED_DAYS = 3;

const needsActionKey = (videoId: string) => `media-transcode:${videoId}`;

async function internalKey(env: TroubleshootEnv): Promise<string> {
	const k = env.INTERNAL_API_KEY;
	if (!k) return '';
	return typeof k === 'string' ? k : await k.get();
}

async function callMedia(env: TroubleshootEnv, path: string, init?: { method: string; json: unknown }): Promise<Response> {
	if (!env.MEDIA_WORKER) throw new Error('MEDIA_WORKER is not bound');
	return env.MEDIA_WORKER.fetch(`https://media.internal${path}`, {
		method: init?.method ?? 'GET',
		headers: { 'X-API-Key': await internalKey(env), ...(init ? { 'content-type': 'application/json' } : {}) },
		...(init ? { body: JSON.stringify(init.json) } : {}),
	});
}

/** The video's Transcoder view; null when the media Worker could not be asked. */
export async function askTranscoder(env: TroubleshootEnv, videoId: string): Promise<TranscoderAnswer | null> {
	if (!env.MEDIA_WORKER) return null;
	try {
		const res = await callMedia(env, `/internal/jobs/${encodeURIComponent(videoId)}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as Partial<TranscoderAnswer>;
		return { view: body.view ?? null, startFailure: body.startFailure ?? null, durableObjectId: body.durableObjectId ?? null };
	} catch (error) {
		logger.warn('[MediaTroubleshoot] Transcoder state unavailable', { videoId, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

interface JobRow {
	video_id: string;
	job_id: string;
	status: string;
	attempts: number | null;
	queued_at: string | null;
	started_at: string | null;
	failed_at: string | null;
	error: string | null;
	updated_at: string;
	source_facts?: string | null;
}

const clip = (text: string | null | undefined) => (text ? scrubOpsText(text).slice(0, 300) : null);

/** The stored source facts without the hash. */
function sourceOf(json: string | null | undefined): TroubleshootSource | null {
	if (!json) return null;
	try {
		const facts = sanitizeSourceFacts(JSON.parse(json));
		if (!facts) return null;
		const rest: TroubleshootSource & { sha256?: string } = facts;
		delete rest.sha256;
		return rest;
	} catch {
		return null;
	}
}

/** One row of the panel from media_jobs and the Transcoder's answer. Pure (tested). */
export function toTroubleshootJob(row: JobRow, title: string | null, answer: TranscoderAnswer | null, asked: boolean): TroubleshootJob {
	const view = answer?.view && answer.view.jobId === row.job_id ? answer.view : null;
	const start = answer?.startFailure && answer.startFailure.jobId === row.job_id ? answer.startFailure : null;
	const state = troubleshootState(row, view, start);
	const rawError = state === 'start_retry' && start ? `${start.reason}: ${start.error}` : (view?.error ?? row.error ?? null);
	const error = state === 'cancelled' ? 'cancelled' : clip(rawError);
	const reason = state === 'cancelled' ? 'cancelled' : transcodeErrorReason(rawError);
	const attempt = state === 'start_retry' && start ? start.deliveries : (view?.attempt ?? Number(row.attempts ?? 0));
	const maxAttempts = state === 'start_retry' && start ? start.maxDeliveries : (view?.maxAttempts ?? null);
	const nextRetryAt = state === 'start_retry' ? (start?.nextRetryAt ?? null) : state === 'waiting_retry' ? (view?.nextRetryAt ?? null) : null;
	return {
		videoId: row.video_id,
		jobId: row.job_id,
		title,
		state,
		attempt,
		maxAttempts,
		queuedAt: row.queued_at,
		startedAt: view?.attemptStartedAt ?? row.started_at,
		nextRetryAt,
		lastSeenAt: state === 'running' ? (view?.lastSeenAt ?? null) : null,
		progress: state === 'running' ? (view?.progress ?? null) : null,
		reason,
		error,
		source: state === 'failed' ? sourceOf(row.source_facts) : null,
		instance: { name: row.video_id, durableObjectId: answer?.durableObjectId ?? null, state: null },
		...(asked && !answer ? { transcoderUnavailable: true } : {}),
	};
}

async function titles(env: TroubleshootEnv, ids: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (!env.SEARCH_DB || !ids.length) return out;
	try {
		const { results } = await env.SEARCH_DB.prepare(`SELECT id, admin_title AS title FROM content_ownership WHERE kind = 'video' AND id IN (SELECT value FROM json_each(?))`)
			.bind(JSON.stringify(ids))
			.all<{ id: string; title: string | null }>();
		for (const r of results ?? []) if (r.title) out.set(r.id, r.title);
	} catch (error) {
		logger.warn('[MediaTroubleshoot] Titles unavailable', { error: error instanceof Error ? error.message : String(error) });
	}
	return out;
}

async function activeRows(env: TroubleshootEnv): Promise<JobRow[]> {
	if (!env.SEARCH_DB) return [];
	const { results } = await env.SEARCH_DB.prepare(
		`SELECT video_id, job_id, status, attempts, queued_at, started_at, failed_at, error, updated_at FROM media_jobs
		 WHERE status IN ('queued', 'transcoding') ORDER BY queued_at LIMIT ?`,
	)
		.bind(ACTIVE_LIMIT)
		.all<JobRow>();
	return results ?? [];
}

/** The panel's job list: active jobs first (oldest wait first), then failed and cancelled ones, newest first. */
export async function readTroubleshootJobs(env: TroubleshootEnv, now = Date.now()): Promise<TroubleshootJobs> {
	const at = new Date(now).toISOString();
	if (!env.SEARCH_DB) return { items: [], at, transcoder: env.MEDIA_WORKER ? 'ok' : 'unbound' };
	const since = new Date(now - FINISHED_DAYS * 86400_000).toISOString();
	const [active, finished] = await Promise.all([
		activeRows(env),
		env.SEARCH_DB.prepare(
			`SELECT video_id, job_id, status, attempts, queued_at, started_at, failed_at, error, updated_at, source_facts FROM media_jobs
			 WHERE status IN ('failed', 'cancelled') AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
		)
			.bind(since, FINISHED_LIMIT)
			.all<JobRow>()
			.then((r) => r.results ?? []),
	]);
	const names = await titles(env, [...active, ...finished].map((r) => r.video_id));
	const asked = !!env.MEDIA_WORKER;
	const answers = await Promise.all(active.map((r) => askTranscoder(env, r.video_id)));
	const failedAsks = asked && active.length > 0 && answers.every((a) => a === null);
	return {
		items: [
			...active.map((r, i) => toTroubleshootJob(r, names.get(r.video_id) ?? null, answers[i] ?? null, asked)),
			...finished.map((r) => toTroubleshootJob(r, names.get(r.video_id) ?? null, null, false)),
		],
		at,
		transcoder: !asked ? 'unbound' : failedAsks ? 'error' : 'ok',
	};
}

// ---------------------------------------------------------------------------
// Admin actions (run from the admin-jobs queue, so they retry with backoff and dead-letter)
// ---------------------------------------------------------------------------

export type RetryNowOutcome = 'queued_again' | 'retry_started' | 'resent' | 'running' | 'not_found';

const repo = (env: TroubleshootEnv) => new R2Repository<MediaVideo>(env.videos);

/**
 * "Retry now": a failed or cancelled job is transcoded again (a new job); a job waiting for its
 * retry runs it at once; a job that never started is sent to the queue again under the same job id
 * (the delayed delivery then finds it started: a duplicate). A running job is left alone. Throws on
 * a transient failure, so the admin job retries.
 */
export async function retryTranscodeNow(env: TroubleshootEnv, videoId: string): Promise<RetryNowOutcome> {
	const video = await repo(env).getObject(videoId);
	const r2 = video?.r2;
	if (!video || !r2) return 'not_found';
	if (r2.status === 'failed' || r2.status === 'cancelled' || r2.status === 'ready') {
		const r = await enqueueTranscode(env, videoId, 'retry', { force: true });
		if (!r.queued) throw new Error(`Could not queue the transcode again: ${r.why ?? 'unknown'}`);
		return 'queued_again';
	}
	const answer = await askTranscoder(env, videoId);
	if (!answer) throw new Error('The transcoder could not be asked');
	const view = answer.view && answer.view.jobId === r2.jobId ? answer.view : null;
	if (view?.status === 'running' || view?.status === 'stopping') return 'running';
	if (view?.status === 'waiting_retry') {
		const res = await callMedia(env, `/internal/jobs/${encodeURIComponent(videoId)}/retry-now`, { method: 'POST', json: { jobId: r2.jobId } });
		if (!res.ok) throw new Error(`retry-now HTTP ${res.status}`);
		return 'retry_started';
	}
	if (!env.TRANSCODE_QUEUE) throw new Error('TRANSCODE_QUEUE is not bound');
	// Never started: the same job again, now (same id and rev, so nothing it wrote is orphaned)
	const message: TranscodeJobMessage = { kind: 'transcode', videoId, jobId: r2.jobId, rev: r2.rev, access: r2.access, queuedAt: r2.queuedAt, reason: 'retry' };
	await env.TRANSCODE_QUEUE.send(message);
	return 'resent';
}

export type CancelOutcome = 'cancelled' | 'already_finished' | 'not_found';

/**
 * "Cancel": the Transcoder stops the container, marks the job cancelled and deletes its partial
 * output; then the record is marked cancelled, so the sweep never queues it again. Idempotent;
 * throws on a transient failure (the admin job retries).
 */
export async function cancelTranscode(env: TroubleshootEnv & ErrorReporterEnv, ctx: ExecutionContextLike | undefined, videoId: string, actorId: string): Promise<CancelOutcome> {
	const video = await repo(env).getObject(videoId);
	const r2 = video?.r2;
	if (!video || !r2) return 'not_found';
	if (r2.status === 'cancelled') return 'cancelled';
	if (r2.status !== 'queued' && r2.status !== 'transcoding') return 'already_finished';
	const res = await callMedia(env, `/internal/jobs/${encodeURIComponent(videoId)}/cancel`, { method: 'POST', json: { jobId: r2.jobId, rev: r2.rev, access: r2.access, queuedAt: r2.queuedAt } });
	if (!res.ok) throw new Error(`cancel HTTP ${res.status}`);
	const { outcome } = (await res.json()) as { outcome?: string };
	if (outcome === 'already_finished') return 'already_finished';
	const jobId = r2.jobId;
	const at = new Date().toISOString();
	const saved = await repo(env).updateObject(videoId, (v) => {
		if (!v.r2 || v.r2.jobId !== jobId || (v.r2.status !== 'queued' && v.r2.status !== 'transcoding')) return false;
		v.r2.status = 'cancelled';
		v.r2.error = 'cancelled';
		v.r2.failedAt = at;
		v.r2.cancelledBy = actorId;
		delete v.r2.progress;
		const ref = (v as MediaVideo & { media?: { providers: { r2?: { status: string; error?: string } } } }).media?.providers.r2;
		if (ref) {
			ref.status = 'failed';
			ref.error = 'cancelled';
		}
		v.dateModified = at;
		return true;
	});
	if (saved) {
		await recordJob(env, saved);
		pushMediaLive(env as never, ctx, saved);
	}
	// Nothing left to act on: a stall or failure item of this video is closed
	resolveNeedsAction(env, ctx, needsActionKey(videoId));
	logger.warn('[MediaTroubleshoot] Transcode cancelled by an admin', { videoId, jobId, actorId });
	return 'cancelled';
}

// ---------------------------------------------------------------------------
// Stall rules (the 10-minute sweep)
// ---------------------------------------------------------------------------

/** The sweep's interval: a stall is reported by the first sweep that sees it, never again (the Errors page reopens an item on every report). */
export const SWEEP_MS = 10 * 60 * 1000;

const THRESHOLD: Record<TranscodeStall['kind'], number> = { no_progress: STALL_RUNNING_MS, retry_late: STALL_RETRY_LATE_MS, queued_too_long: STALL_QUEUED_MS };

/** First seen by this sweep: the stall began within the last sweep interval. Pure. */
export function stallIsNew(stall: TranscodeStall): boolean {
	return stall.minutes * 60_000 < THRESHOLD[stall.kind] + SWEEP_MS;
}

const STALL_TITLE: Record<TranscodeStall['kind'], (m: number) => string> = {
	no_progress: (m) => `R2 transcode running with no progress for ${m} min`,
	retry_late: (m) => `R2 transcode retry is ${m} min late`,
	queued_too_long: (m) => `R2 transcode waiting to start for ${m} min`,
};

/** The Errors page item of a stall (same key as the job's failure, resolved when it is ready). */
export function stallNotice(videoId: string, jobId: string, stall: TranscodeStall, error: string | null) {
	return {
		key: needsActionKey(videoId),
		source: 'processing' as const,
		title: STALL_TITLE[stall.kind](stall.minutes),
		message: `Job ${jobId}: ${STALL_TITLE[stall.kind](stall.minutes)}.${error ? ` Last error: ${error}.` : ''} See Delivery → Transcode troubleshooting for its state and logs.`,
		itemType: 'video' as const,
		itemId: videoId,
		itemUrl: `/delivery?video=${encodeURIComponent(videoId)}#transcode-troubleshooting`,
		retry: { kind: 'service' as const, service: 'api-videos', path: '/internal/media/troubleshoot/retry-now', body: { videoId } },
		retryLabel: 'Retry now',
		extra: { stall: stall.kind, minutes: stall.minutes, jobId },
	};
}

/** The sweep: stalled active jobs raise their Errors page item once. Never throws. */
export async function flagStalledTranscodes(env: TroubleshootEnv & ErrorReporterEnv, ctx: ExecutionContextLike | undefined, now = Date.now()): Promise<{ flagged: number }> {
	let flagged = 0;
	try {
		const rows = await activeRows(env);
		// Every slot busy: jobs that never started are waiting their turn, not stalled
		const slotsFull = rows.length ? await transcodeSlotsFull(env as never, now) : false;
		for (const row of rows) {
			const answer = env.MEDIA_WORKER ? await askTranscoder(env, row.video_id) : null;
			// The transcoder could not be asked: only the "never started" rule can be judged from our own record
			if (env.MEDIA_WORKER && !answer) continue;
			const stall = transcodeStall(row, answer?.view ?? null, now, { slotsFull });
			if (!stall || !stallIsNew(stall)) continue;
			const view = answer?.view && answer.view.jobId === row.job_id ? answer.view : null;
			const start = answer?.startFailure && answer.startFailure.jobId === row.job_id ? answer.startFailure : null;
			const error = clip(start ? `${start.reason}: ${start.error}` : (view?.error ?? row.error));
			logger.warn('[MediaTroubleshoot] Transcode stalled', { videoId: row.video_id, jobId: row.job_id, stall: stall.kind, minutes: stall.minutes });
			reportNeedsAction('api-videos', env, ctx, stallNotice(row.video_id, row.job_id, stall, error));
			flagged++;
		}
	} catch (error) {
		logger.error('[MediaTroubleshoot] Stall check failed', { error: error instanceof Error ? error.message : String(error) });
	}
	return { flagged };
}

// ---------------------------------------------------------------------------
// Admin job handlers (lib/admin/service.ts ADMIN_JOB_HANDLERS)
// ---------------------------------------------------------------------------

/** Runs `fn` with an execution context whose background work (reports, live events) is awaited before it returns. */
async function withSettledWork<T>(fn: (ctx: ExecutionContextLike) => Promise<T>): Promise<T> {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as ExecutionContextLike;
	try {
		return await fn(ctx);
	} finally {
		await Promise.allSettled(pending);
	}
}

/** media.transcode-retry / media.transcode-cancel: one video, idempotent; a throw retries the job. */
export async function runTranscodeAction(env: TroubleshootEnv & ErrorReporterEnv, job: { kind: string; targetId: string; actorId: string }): Promise<{ done: true; result: Record<string, unknown> }> {
	const videoId = job.targetId;
	if (job.kind === 'media.transcode-cancel') {
		const outcome = await withSettledWork((ctx) => cancelTranscode(env, ctx, videoId, job.actorId));
		return { done: true, result: { outcome } };
	}
	const outcome = await retryTranscodeNow(env, videoId);
	return { done: true, result: { outcome } };
}

/** The Errors page item when a Retry now / Cancel job gave up (Retry queues the job again). */
export function actionFailedNotice(job: { id: string; kind: string; targetId: string }, reason: string) {
	const what = job.kind === 'media.transcode-cancel' ? 'Cancel' : 'Retry now';
	return {
		key: `media-transcode-action:${job.id}`,
		source: 'processing' as const,
		title: `R2 transcode ${what} failed`,
		message: `${what} on video ${job.targetId} gave up after its retries: ${scrubOpsText(reason).slice(0, 300)}`,
		itemType: 'video' as const,
		itemId: job.targetId,
		itemUrl: `/delivery?video=${encodeURIComponent(job.targetId)}#transcode-troubleshooting`,
		retry: { kind: 'service' as const, service: 'api-videos', path: '/internal/media/troubleshoot/jobs/retry', body: { jobId: job.id } },
		retryLabel: `${what} again`,
		extra: { jobId: job.id, kind: job.kind, videoId: job.targetId },
	};
}

/** Reports a media action job that gave up (awaits the report: the queue handler returns right after). */
export async function reportActionFailed(env: ErrorReporterEnv, job: { id: string; kind: string; targetId: string }, reason: string): Promise<void> {
	await withSettledWork(async (ctx) => {
		reportNeedsAction('api-videos', env, ctx, actionFailedNotice(job, reason));
	});
}
