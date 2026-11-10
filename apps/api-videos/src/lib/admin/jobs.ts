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
 *              retryJob() queues it again with a fresh retry budget.
 *
 * Rows live in SEARCH_DB.admin_jobs (migration search/0006).
 */
import { decodeCursor, encodeCursor, keysetQuery } from '../search/keyset';
import { ADMIN_JOB_MAX_RETRIES, MessageType, type AdminJob, type AdminJobKind, type AdminJobStatus, type AdminJobTarget } from '@al-ummah/shared-types';
import { logger } from '../logger';
import type { SearchDb } from '@al-ummah/shared-types';

export interface JobQueue {
	send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
}

export interface JobEnv {
	SEARCH_DB?: SearchDb;
	ADMIN_JOBS_QUEUE?: JobQueue;
}

/**
 * What a job handler returns: done, or another step to queue (resumable work),
 * optionally after `delaySeconds` (work that waits for a backoff to run out).
 */
export type JobOutcome =
	| { done: true; result?: Record<string, unknown> }
	| { done: false; params: Record<string, unknown>; result?: Record<string, unknown>; delaySeconds?: number };
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
}

const COLUMNS = 'id, kind, target_kind, target_id, params, status, attempts, last_error, result, actor_id, created_at, updated_at, finished_at';
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
	const row = await db(env).prepare(`SELECT ${COLUMNS} FROM admin_jobs WHERE id = ?`).bind(id).first<JobRow>();
	return row ? toJob(row) : null;
}

export async function listJobs(env: JobEnv, query: { status?: string; targetKind?: string; targetId?: string; limit?: number }): Promise<AdminJob[]> {
	return (await listJobsPage(env, query)).items;
}

/**
 * One page of jobs, newest first, after `cursor` (the previous page's): a
 * keyset seek of idx_admin_jobs_feed / _status_feed / _target_feed
 * (migration 0014), however far back the page is.
 */
export async function listJobsPage(
	env: JobEnv,
	query: { status?: string; targetKind?: string; targetId?: string; limit?: number; cursor?: string },
): Promise<{ items: AdminJob[]; cursor: string }> {
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
	const result = await keysetQuery<JobRow & Record<string, unknown>>(db(env), {
		from: 'admin_jobs',
		select: COLUMNS,
		where,
		params: args,
		columns: ['created_at', 'id'],
		direction: 'DESC',
		after: decodeCursor(query.cursor, 'jobs', ['string', 'string']),
		limit,
	});
	return { items: result.rows.map(toJob), cursor: result.hasMore && result.last ? encodeCursor('jobs', result.last) : '' };
}

export async function countJobs(env: JobEnv, status: AdminJobStatus): Promise<number> {
	const row = await db(env).prepare('SELECT COUNT(*) AS n FROM admin_jobs WHERE status = ?').bind(status).first<{ n: number }>();
	return Number(row?.n ?? 0);
}

async function setStatus(env: JobEnv, id: string, fields: Partial<{ status: AdminJobStatus; attempts: number; last_error: string | null; result: string | null; params: string; finished_at: string | null }>): Promise<void> {
	const entries = Object.entries(fields);
	await db(env)
		.prepare(`UPDATE admin_jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
		.bind(...entries.map(([, v]) => v), now(), id)
		.run();
}

const message = (jobId: string) => ({ id: crypto.randomUUID(), type: MessageType.AdminJob, payload: { jobId }, timestamp: Date.now() });

/** Queues the job's next run; when the queue refuses, the job is marked failed so the admin sees it and can retry. */
async function enqueue(env: JobEnv, job: AdminJob, delaySeconds?: number): Promise<AdminJob> {
	try {
		if (!env.ADMIN_JOBS_QUEUE) throw new Error('ADMIN_JOBS_QUEUE is not bound');
		await env.ADMIN_JOBS_QUEUE.send(message(job.id), delaySeconds ? { delaySeconds } : undefined);
		return job;
	} catch (error) {
		const reason = `Could not queue the job: ${error instanceof Error ? error.message : String(error)}`;
		logger.error('[AdminJobs] Enqueue failed', { alert: 'admin_job_failed', jobId: job.id, kind: job.kind, error: reason });
		await setStatus(env, job.id, { status: 'failed', last_error: reason, finished_at: now() });
		return { ...job, status: 'failed', lastError: reason };
	}
}

export async function createJob(env: JobEnv, input: { kind: AdminJobKind; targetKind: AdminJobTarget; targetId: string; params?: Record<string, unknown>; actorId: string }): Promise<AdminJob> {
	const at = now();
	const job: AdminJob = {
		id: crypto.randomUUID(),
		kind: input.kind,
		targetKind: input.targetKind,
		targetId: input.targetId,
		params: input.params ?? {},
		status: 'queued',
		attempts: 0,
		lastError: null,
		result: null,
		actorId: input.actorId,
		createdAt: at,
		updatedAt: at,
		finishedAt: null,
	};
	await db(env)
		.prepare(`INSERT INTO admin_jobs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(job.id, job.kind, job.targetKind, job.targetId, JSON.stringify(job.params), job.status, 0, null, null, job.actorId, at, at, null)
		.run();
	return enqueue(env, job);
}

/** Queues a failed job again with a fresh retry budget. Only failed jobs can be retried. */
export async function retryJob(env: JobEnv, id: string): Promise<AdminJob | null> {
	const job = await getJob(env, id);
	if (!job || job.status !== 'failed') return job;
	await setStatus(env, id, { status: 'queued', attempts: 0, last_error: null, finished_at: null });
	return enqueue(env, { ...job, status: 'queued', attempts: 0, lastError: null, finishedAt: null });
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
export async function handleAdminJobBatch(batch: { messages: readonly JobMessage[] }, env: JobEnv, handlers: Partial<Record<AdminJobKind, JobHandler>>): Promise<void> {
	for (const msg of batch.messages) {
		const jobId = (msg.body as { payload?: { jobId?: unknown } } | null)?.payload?.jobId;
		if (typeof jobId !== 'string') {
			logger.error('[AdminJobs] Message without a job id', { body: msg.body });
			msg.ack();
			continue;
		}
		let job: AdminJob | null;
		try {
			job = await getJob(env, jobId);
		} catch (error) {
			logger.warn('[AdminJobs] Could not read the job; retrying', { jobId, error: error instanceof Error ? error.message : String(error) });
			msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
			continue;
		}
		// Gone or finished (a failed job only runs again through retryJob, with a new message)
		if (!job || job.status === 'succeeded' || job.status === 'failed') {
			msg.ack();
			continue;
		}
		const handler = handlers[job.kind];
		if (!handler) {
			await setStatus(env, job.id, { status: 'failed', last_error: `No handler for ${job.kind}`, finished_at: now() });
			msg.ack();
			continue;
		}
		await setStatus(env, job.id, { status: 'running', attempts: msg.attempts });
		try {
			const outcome = await handler(env, { ...job, attempts: msg.attempts });
			if (!('params' in outcome)) {
				await setStatus(env, job.id, { status: 'succeeded', result: outcome.result ? JSON.stringify(outcome.result) : null, last_error: null, finished_at: now() });
				logger.info('[AdminJobs] Job succeeded', { jobId: job.id, kind: job.kind, target: job.targetId, attempts: msg.attempts });
			} else {
				// Resumable work: store the next step and queue it as a fresh delivery
				await setStatus(env, job.id, { status: 'queued', params: JSON.stringify(outcome.params), result: outcome.result ? JSON.stringify(outcome.result) : null });
				const delaySeconds = Math.max(0, Math.floor(Number(outcome.delaySeconds) || 0));
				await env.ADMIN_JOBS_QUEUE!.send(message(job.id), delaySeconds ? { delaySeconds } : undefined);
			}
			msg.ack();
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const last = msg.attempts > ADMIN_JOB_MAX_RETRIES;
			await setStatus(env, job.id, last ? { status: 'failed', last_error: reason, finished_at: now() } : { status: 'retrying', last_error: reason }).catch(() => undefined);
			if (last) {
				// Flags the admin: the job shows "failed — Retry", and this alert reaches the logs
				logger.error('[AdminJobs] Job failed after retries', { alert: 'admin_job_failed', jobId: job.id, kind: job.kind, target: job.targetId, attempts: msg.attempts, error: reason });
			} else {
				logger.warn('[AdminJobs] Job attempt failed; retrying', { jobId: job.id, kind: job.kind, attempts: msg.attempts, error: reason });
			}
			// After max_retries the queue moves the message to the DLQ
			msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
		}
	}
}
