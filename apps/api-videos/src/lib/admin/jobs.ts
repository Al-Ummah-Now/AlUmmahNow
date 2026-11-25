/**
 * Admin jobs: heavy admin actions run from the admin-jobs queue, never inside
 * the request (owner rule: async, queued, retried, failures flag the admin).
 *
 *   request  → quick single-record change + createJob() → 202 with the job
 *   consumer → runs the job (idempotent) → succeeded
 *            → throws → retried with backoff (status 'retrying', last_error)
 *            → last attempt fails → status 'failed' and the message goes to
 *              the DLQ (the processor stores it in dead_letters)
 *   admin    → sees "failed — Retry" on the item and in the failed-jobs list;
 *              retryJob() queues it again with a fresh retry budget;
 *              cancelJob() stops a job that has not finished (it runs again only through Retry).
 *
 * Rows live in SEARCH_DB.admin_jobs (migration search/0006); next_run_at and the per-job log
 * (admin_job_log, the newest ADMIN_JOB_LOG_LIMIT lines) come from search/0071 (TA-8: the Jobs page shows
 * attempts n/max, the next retry and what happened). Log writes never fail or stall the job.
 */
import { ADMIN_JOB_LOG_LIMIT, ADMIN_JOB_MAX_RETRIES, ADMIN_JOB_UNCANCELLABLE_KINDS, collectPersonIds, type AdminJobLogEntry, type AdminJobLogEvent, ERASED_USER_ID, MessageType, publishAdminLive, type AdminLiveEnv, type AdminJob, type AdminJobKind, type AdminJobStatus, type AdminJobTarget } from '@al-ummah/shared-types';
import { logger } from '../logger';
import type { SearchDb } from '@al-ummah/shared-types';

export interface JobQueue {
	send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
}

export interface JobEnv extends AdminLiveEnv {
	SEARCH_DB?: SearchDb;
	ADMIN_JOBS_QUEUE?: JobQueue;
	/** Run-account erasures (#887): their own queue, consumed with a concurrency cap */
	RUN_ERASE_QUEUE?: JobQueue;
}

/** Job kinds that run on RUN_ERASE_QUEUE when it is bound. */
const RUN_ERASE_KINDS = new Set<string>(['user.erase-run']);

/** The queue a job's deliveries go to. */
export function jobQueueFor(env: JobEnv, kind: string): JobQueue | undefined {
	return RUN_ERASE_KINDS.has(kind) && env.RUN_ERASE_QUEUE ? env.RUN_ERASE_QUEUE : env.ADMIN_JOBS_QUEUE;
}

/** What a job handler returns: done, or another step to queue (resumable work); `delaySeconds` waits before
 *  that step runs (e.g. until a video finished processing); `note` is why it waits (shown as the job's reason; null clears it).
 *  `later`: not this delivery's to do (another one may be at work): the same delivery again after so many seconds, unless the
 *  job has moved on by then. Nothing of the job's row is written. */
export type JobOutcome = { later: number } | { done: true; result?: Record<string, unknown> } | { done: false; params: Record<string, unknown>; result?: Record<string, unknown>; delaySeconds?: number; note?: string | null };
export type JobHandler = (env: unknown, job: AdminJob) => Promise<JobOutcome>;

interface JobRow {
	id: string;
	kind: string;
	target_kind: string;
	target_id: string;
	params: string;
	status: string;
	attempts: number;
	last_error: string | null;
	result: string | null;
	actor_id: string;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
	next_run_at?: string | null;
	run_id?: string | null;
}

const COLUMNS = 'id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at, next_run_at, run_id';
const INSERT_COLUMNS = 'id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at, run_id';
/** Deliveries a run gets: the first plus the queue's max_retries. */
export const ADMIN_JOB_MAX_ATTEMPTS = ADMIN_JOB_MAX_RETRIES + 1;
/** Statuses a job never leaves by itself. */
const FINISHED = new Set<string>(['succeeded', 'failed', 'cancelled']);
const now = () => new Date().toISOString();

function parse(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

export function toJob(row: JobRow): AdminJob {
	return {
		id: row.id,
		kind: row.kind as AdminJobKind,
		targetKind: row.target_kind as AdminJobTarget,
		targetId: row.target_id,
		params: parse(row.params) ?? {},
		status: row.status as AdminJobStatus,
		attempts: Number(row.attempts) || 0,
		maxAttempts: ADMIN_JOB_MAX_ATTEMPTS,
		nextRunAt: row.next_run_at ?? null,
		lastError: row.last_error,
		result: parse(row.result),
		actorId: row.actor_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
	};
}

function db(env: JobEnv): SearchDb {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

export async function getJob(env: JobEnv, id: string): Promise<AdminJob | null> {
	const row = await readRow(env, id);
	return row ? toJob(row) : null;
}

const readRow = (env: JobEnv, id: string) => db(env).prepare(`SELECT ${COLUMNS} FROM admin_jobs WHERE id = ?`).bind(id).first<JobRow>();

interface LogRow { at: string; event: string; attempt: number | null; error: string | null; delay_seconds: number | null; retried: number | null; actor_id?: string | null; actor_name?: string | null }

/** The job's log, oldest first. */
export async function readJobLog(env: JobEnv, id: string): Promise<AdminJobLogEntry[]> {
	const { results } = await db(env)
		.prepare(`SELECT at, event, attempt, error, delay_seconds, retried, actor_id, actor_name FROM (SELECT * FROM admin_job_log WHERE job_id = ? ORDER BY id DESC LIMIT ${ADMIN_JOB_LOG_LIMIT}) ORDER BY id`)
		.bind(id)
		.all<LogRow>();
	return (results ?? []).map((r) => ({
		at: r.at,
		event: r.event as AdminJobLogEvent,
		...(r.attempt != null ? { attempt: Number(r.attempt) } : {}),
		...(r.error ? { error: r.error } : {}),
		...(r.delay_seconds != null ? { delaySeconds: Number(r.delay_seconds) } : {}),
		...(r.retried ? { retried: true } : {}),
		...(r.actor_id ? { by: { id: r.actor_id, name: r.actor_name ?? null } } : {}),
	}));
}

/** The job with its log (GET /jobs/:id). */
export async function getJobWithLog(env: JobEnv, id: string): Promise<AdminJob | null> {
	const job = await getJob(env, id);
	return job ? { ...job, log: await readJobLog(env, id).catch(() => []) } : null;
}

/** Adds a log line and drops the oldest past the limit. Never throws: the log never fails the job. */
async function log(env: JobEnv, jobId: string, entry: Omit<AdminJobLogEntry, 'at'>): Promise<void> {
	try {
		const store = db(env);
		await store.batch([
			store
				.prepare(
					entry.by
						? 'INSERT INTO admin_job_log (job_id, at, event, attempt, error, delay_seconds, retried, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
						: 'INSERT INTO admin_job_log (job_id, at, event, attempt, error, delay_seconds, retried) VALUES (?, ?, ?, ?, ?, ?, ?)',
				)
				.bind(
					jobId,
					now(),
					entry.event,
					entry.attempt ?? null,
					entry.error ? entry.error.slice(0, 2000) : null,
					entry.delaySeconds ?? null,
					entry.retried ? 1 : 0,
					...(entry.by ? [entry.by.id.slice(0, 64), entry.by.name ? entry.by.name.slice(0, 200) : null] : []),
				),
			store
				.prepare(`DELETE FROM admin_job_log WHERE job_id = ?1 AND id <= (SELECT id FROM admin_job_log WHERE job_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ${ADMIN_JOB_LOG_LIMIT})`)
				.bind(jobId),
		]);
	} catch (error) {
		logger.warn('[AdminJobs] Could not write the job log', { jobId, event: entry.event, error: error instanceof Error ? error.message : String(error) });
	}
}

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export async function listJobs(env: JobEnv, query: { status?: string; targetKind?: string; targetId?: string; limit?: number }): Promise<AdminJob[]> {
	const where: string[] = [];
	const args: unknown[] = [];
	if (query.status) {
		where.push('status = ?');
		args.push(query.status);
	}
	if (query.targetKind && query.targetId) {
		where.push('target_kind = ? AND target_id = ?');
		args.push(query.targetKind, query.targetId);
	}
	const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
	const { results } = await db(env)
		.prepare(`SELECT ${COLUMNS} FROM admin_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
		.bind(...args, limit)
		.all<JobRow>();
	return (results ?? []).map(toJob);
}

export async function countJobs(env: JobEnv, status: AdminJobStatus): Promise<number> {
	const row = await db(env).prepare('SELECT COUNT(*) AS n FROM admin_jobs WHERE status = ?').bind(status).first<{ n: number }>();
	return Number(row?.n ?? 0);
}

type JobRef = Pick<AdminJob, 'id' | 'kind' | 'targetKind' | 'targetId'>;

/**
 * The admin:jobs live event of a status change (docs/admin/LIVE_OPS.md): a hint, pages refetch the job. Not what it
 * is about: every admin gets it, and some targets are for super admins only (a takedown's).
 */
export function jobLiveEvent(job: JobRef, status: AdminJobStatus, attempts?: number) {
	return { kind: 'job', key: `job:${job.id}`, id: job.id, jobKind: job.kind, status, ...(attempts !== undefined ? { attempts } : {}) };
}

type StatusFields = Partial<{ status: AdminJobStatus; attempts: number; last_error: string | null; result: string | null; params: string; finished_at: string | null; target_id: string; next_run_at: string | null; run_id: string }>;

/**
 * Writes the job's fields. The consumer's writes pass `unlessCancelled`: an admin's Cancel wins over a
 * delivery already in flight. Returns whether the row changed.
 */
async function setStatus(env: JobEnv, job: JobRef, fields: StatusFields, opts: { unlessCancelled?: boolean } = {}): Promise<boolean> {
	const entries = Object.entries(fields);
	const out = await db(env)
		.prepare(`UPDATE admin_jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?${opts.unlessCancelled ? " AND status != 'cancelled'" : ''}`)
		.bind(...entries.map(([, v]) => v), now(), job.id)
		.run();
	const changed = opts.unlessCancelled ? Number((out as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 1) > 0 : true;
	// Never throws, gives up after a few seconds: a live update never fails or stalls the job
	if (changed && fields.status) await publishAdminLive(env, 'jobs', jobLiveEvent(job, fields.status, fields.attempts));
	return changed;
}

/** A delivery of the job's run `runId` (messages from before a Cancel carry an older one). */
const message = (jobId: string, runId: string | null, ifUnmovedSince?: string) => ({ id: crypto.randomUUID(), type: MessageType.AdminJob, payload: { jobId, ...(runId ? { runId } : {}), ...(ifUnmovedSince ? { ifUnmovedSince } : {}) }, timestamp: Date.now() });

/** Queues the job's next run; when the queue refuses, the job is marked failed so the admin sees it and can retry. */
async function enqueue(env: JobEnv, job: AdminJob, runId: string, delaySeconds?: number): Promise<AdminJob> {
	try {
		const queue = jobQueueFor(env, job.kind);
		if (!queue) throw new Error('ADMIN_JOBS_QUEUE is not bound');
		await queue.send(message(job.id, runId), delaySeconds ? { delaySeconds } : undefined);
		return job;
	} catch (error) {
		const reason = `Could not queue the job: ${error instanceof Error ? error.message : String(error)}`;
		logger.error('[AdminJobs] Enqueue failed', { alert: 'admin_job_failed', jobId: job.id, kind: job.kind, error: reason });
		await setStatus(env, job, { status: 'failed', last_error: reason, finished_at: now(), next_run_at: null });
		await log(env, job.id, { event: 'failed', error: reason });
		return { ...job, status: 'failed', lastError: reason };
	}
}

export async function createJob(env: JobEnv, input: { kind: AdminJobKind; targetKind: AdminJobTarget; targetId: string; params?: Record<string, unknown>; actorId: string; delaySeconds?: number }): Promise<AdminJob> {
	const at = now();
	const job: AdminJob = {
		id: crypto.randomUUID(),
		kind: input.kind,
		targetKind: input.targetKind,
		targetId: input.targetId,
		params: input.params ?? {},
		status: 'queued',
		attempts: 0,
		maxAttempts: ADMIN_JOB_MAX_ATTEMPTS,
		nextRunAt: null,
		lastError: null,
		result: null,
		actorId: input.actorId,
		createdAt: at,
		updatedAt: at,
		finishedAt: null,
	};
	const store = db(env);
	const runId = crypto.randomUUID();
	await store
		.prepare(`INSERT INTO admin_jobs (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(job.id, job.kind, job.targetKind, job.targetId, JSON.stringify(job.params), job.status, 0, null, null, job.actorId, at, at, null, runId)
		.run();
	// Who the job names, so an account erasure finds its jobs without a scan (#1253)
	const links = jobUserIds(job).map((userId) => store.prepare('INSERT OR IGNORE INTO admin_job_users (user_id, job_id) VALUES (?, ?)').bind(userId, job.id));
	if (links.length) await store.batch(links);
	await log(env, job.id, { event: 'queued' });
	await publishAdminLive(env, 'jobs', jobLiveEvent(job, 'queued'));
	return enqueue(env, job, runId, input.delaySeconds);
}

/**
 * The accounts a job names: its actor, its target when that is a user, and user ids in its params.
 * Accounts only (usr_…): system actors ('cleanup', the daily checks) and fixed targets are no one.
 */
export function jobUserIds(job: Pick<AdminJob, 'actorId' | 'targetKind' | 'targetId' | 'params'>): string[] {
	const ids = collectPersonIds({ actorId: job.actorId, ...(job.targetKind === 'user' ? { targetUserId: job.targetId } : {}), params: job.params });
	return [...ids].filter((id) => id.startsWith('usr_'));
}

/** Erasure jobs: once one succeeds its row no longer names the erased account (#1253). */
const ERASE_KINDS = new Set<string>(['user.delete-data', 'user.erase-run']);

/** Whether Retry applies: a job that failed, or one an admin cancelled. */
export const canRetry = (job: Pick<AdminJob, 'status'>) => job.status === 'failed' || job.status === 'cancelled';
/** Whether Cancel applies to the kind at all (never to a data erasure). */
export const cancellableKind = (kind: string) => !(ADMIN_JOB_UNCANCELLABLE_KINDS as readonly string[]).includes(kind);
/** Whether Cancel applies: a job of a cancellable kind that has not finished. */
export const canCancel = (job: Pick<AdminJob, 'status' | 'kind'>) => cancellableKind(job.kind) && !FINISHED.has(job.status);

/**
 * Queues a failed job again with a fresh retry budget. A cancelled one only with `allowCancelled`: the
 * Jobs page's Retry, which admin-api allows after checking the job kind's own permissions.
 */
export async function retryJob(env: JobEnv, id: string, opts: { allowCancelled?: boolean } = {}): Promise<AdminJob | null> {
	const job = await getJob(env, id);
	if (!job || !(job.status === 'failed' || (opts.allowCancelled && job.status === 'cancelled'))) return job;
	// A new run: deliveries still queued from the old one are dropped when they arrive
	const runId = crypto.randomUUID();
	await setStatus(env, job, { status: 'queued', attempts: 0, last_error: null, finished_at: null, next_run_at: null, run_id: runId });
	await log(env, job.id, { event: 'queued', retried: true });
	return enqueue(env, { ...job, status: 'queued', attempts: 0, lastError: null, finishedAt: null, nextRunAt: null }, runId);
}

/**
 * Stops a job that has not finished. A queued or waiting delivery is dropped when it arrives; a
 * delivery already running finishes its current step, and nothing after it runs. Retry starts it again
 * from the step it reached (handlers are idempotent and keep their progress in params).
 */
export async function cancelJob(env: JobEnv, id: string, by?: AdminJobLogEntry['by']): Promise<AdminJob | null> {
	const job = await getJob(env, id);
	if (!job || !canCancel(job)) return job;
	const at = now();
	// Only while it is still unfinished: a delivery that finished it meanwhile wins, and the caller sees the job as it is
	const out = await db(env)
		.prepare("UPDATE admin_jobs SET status = 'cancelled', finished_at = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running', 'retrying')")
		.bind(at, at, job.id)
		.run();
	if (Number((out as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0) === 0) return getJob(env, id);
	await publishAdminLive(env, 'jobs', jobLiveEvent(job, 'cancelled', job.attempts));
	await log(env, job.id, { event: 'cancelled', ...(by ? { by } : {}) });
	return { ...job, status: 'cancelled', finishedAt: at, nextRunAt: null };
}

/**
 * Whether an admin cancelled the job: long handlers check it between their own pieces of work (a sync
 * between items), so a Cancel stops them before the step ends. A read error counts as not cancelled.
 */
export async function isCancelled(env: JobEnv, id: string): Promise<boolean> {
	try {
		const row = await db(env).prepare('SELECT status FROM admin_jobs WHERE id = ?').bind(id).first<{ status: string }>();
		return row?.status === 'cancelled';
	} catch {
		return false;
	}
}

/** Exponential backoff between deliveries: 10s, 20s, 40s … capped at 5 minutes. */
export function backoffSeconds(attempt: number): number {
	return Math.min(300, 10 * 2 ** Math.max(0, attempt - 1));
}

export interface JobMessage {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/**
 * Consumer for the admin-jobs queue. Each message carries a job id; the job
 * row says what to do. A handler error retries the message with backoff; the
 * last attempt marks the job failed and lets the message dead-letter.
 */
export async function handleAdminJobBatch(
	batch: { messages: readonly JobMessage[] },
	env: JobEnv,
	handlers: Partial<Record<AdminJobKind, JobHandler>>,
	/** Called once when a job fails for good (its last attempt), e.g. to flag the admin's Errors page */
	onFailed?: (job: AdminJob, error: string) => Promise<void>,
): Promise<void> {
	for (const msg of batch.messages) {
		const payload = (msg.body as { payload?: { jobId?: unknown; runId?: unknown; ifUnmovedSince?: unknown } } | null)?.payload;
		const jobId = payload?.jobId;
		if (typeof jobId !== 'string') {
			logger.error('[AdminJobs] Message without a job id', { body: msg.body });
			msg.ack();
			continue;
		}
		let job: AdminJob | null;
		let runId: string | null = null;
		try {
			const row = await readRow(env, jobId);
			job = row ? toJob(row) : null;
			runId = row?.run_id ?? null;
		} catch (error) {
			logger.warn('[AdminJobs] Could not read the job; retrying', { jobId, error: error instanceof Error ? error.message : String(error) });
			msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
			continue;
		}
		// Gone or finished (a failed or cancelled job only runs again through retryJob, with a new message)
		if (!job || FINISHED.has(job.status)) {
			msg.ack();
			continue;
		}
		// A delivery of an earlier run (queued before a Cancel and the Retry that followed it)
		if (runId && payload?.runId !== undefined && payload.runId !== runId) {
			msg.ack();
			continue;
		}
		// Put off while another delivery was at work, and that one has moved the job on: its own messages carry it
		if (payload?.ifUnmovedSince !== undefined && payload.ifUnmovedSince !== job.updatedAt) {
			msg.ack();
			continue;
		}
		const handler = handlers[job.kind];
		if (!handler) {
			const reason = `No handler for ${job.kind}`;
			await setStatus(env, job, { status: 'failed', last_error: reason, finished_at: now(), next_run_at: null });
			await log(env, job.id, { event: 'failed', error: reason });
			msg.ack();
			continue;
		}
		// Cancelled between the read and now: drop the delivery
		if (!(await setStatus(env, job, { status: 'running', attempts: msg.attempts, next_run_at: null }, { unlessCancelled: true }))) {
			msg.ack();
			continue;
		}
		await log(env, job.id, { event: 'started', attempt: msg.attempts });
		try {
			const outcome = await handler(env, { ...job, attempts: msg.attempts });
			if ('later' in outcome) {
				const moved = (await getJob(env, job.id))?.updatedAt;
				await jobQueueFor(env, job.kind)!.send(message(job.id, runId, moved), { delaySeconds: outcome.later });
			} else if (!('params' in outcome)) {
				const finished = await setStatus(
					env,
					job,
					{
						status: 'succeeded',
						result: outcome.result ? JSON.stringify(outcome.result) : null,
						last_error: null,
						finished_at: now(),
						next_run_at: null,
						// The account is erased: the record keeps the action, not the id (#1253)
						...(ERASE_KINDS.has(job.kind) && job.targetKind === 'user' ? { target_id: ERASED_USER_ID } : {}),
					},
					{ unlessCancelled: true },
				);
				if (finished && ERASE_KINDS.has(job.kind) && job.targetKind === 'user') {
					// Its log lines may name the account too (an attempt's error): scrubbed with the target
					const store = db(env);
					await store.batch([
						store.prepare('DELETE FROM admin_job_users WHERE user_id = ? AND job_id = ?').bind(job.targetId, job.id),
						store.prepare('UPDATE admin_job_log SET error = replace(error, ?, ?) WHERE job_id = ? AND error IS NOT NULL').bind(job.targetId, ERASED_USER_ID, job.id),
						store.prepare('UPDATE admin_jobs SET last_error = replace(last_error, ?, ?) WHERE id = ? AND last_error IS NOT NULL').bind(job.targetId, ERASED_USER_ID, job.id),
					]);
				}
				if (finished) {
					await log(env, job.id, { event: 'succeeded', attempt: msg.attempts });
					logger.info('[AdminJobs] Job succeeded', { jobId: job.id, kind: job.kind, target: job.targetId, attempts: msg.attempts });
				}
			} else {
				// Resumable work: store the next step and queue it as a fresh delivery (unless an admin cancelled it meanwhile)
				const delay = Math.min(43200, Math.max(0, Math.round(outcome.delaySeconds ?? 0)));
				const next = await setStatus(
					env,
					job,
					{ status: 'queued', params: JSON.stringify(outcome.params), result: outcome.result ? JSON.stringify(outcome.result) : null, next_run_at: delay ? later(delay) : null, ...(outcome.note !== undefined ? { last_error: outcome.note } : {}) },
					{ unlessCancelled: true },
				);
				if (next) {
					if (delay) await log(env, job.id, { event: 'waiting', attempt: msg.attempts, delaySeconds: delay });
					await jobQueueFor(env, job.kind)!.send(message(job.id, runId), delay ? { delaySeconds: delay } : undefined);
				}
			}
			msg.ack();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const last = msg.attempts > ADMIN_JOB_MAX_RETRIES;
			const delay = backoffSeconds(msg.attempts);
			const recorded = await setStatus(
				env,
				job,
				last ? { status: 'failed', last_error: reason, finished_at: now(), next_run_at: null } : { status: 'retrying', last_error: reason, next_run_at: later(delay) },
				{ unlessCancelled: true },
			).catch(() => true);
			// Cancelled while this attempt ran: nothing more runs, no alert
			if (!recorded) {
				msg.ack();
				continue;
			}
			await log(env, job.id, last ? { event: 'failed', attempt: msg.attempts, error: reason } : { event: 'failed_attempt', attempt: msg.attempts, error: reason, delaySeconds: delay });
			if (last) {
				// Flags the admin: the job shows "failed — Retry", and this alert reaches the logs
				logger.error('[AdminJobs] Job failed after retries', { alert: 'admin_job_failed', jobId: job.id, kind: job.kind, target: job.targetId, attempts: msg.attempts, error: reason });
				// R2 transcode actions also raise an Errors page item with Retry (videos admin → Delivery)
				if (job.kind.startsWith('media.transcode-')) {
					const { reportActionFailed } = await import('../media/troubleshoot');
					await reportActionFailed(env as never, job, reason).catch(() => undefined);
				}
				if (onFailed) await onFailed(job, reason).catch(() => undefined);
			} else {
				logger.warn('[AdminJobs] Job attempt failed; retrying', { jobId: job.id, kind: job.kind, attempts: msg.attempts, error: reason });
			}
			// After max_retries the queue moves the message to the DLQ
			msg.retry({ delaySeconds: delay });
		}
	}
}
