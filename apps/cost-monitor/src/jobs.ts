/**
 * The collector's work runs as queued jobs (COST-1; owner rule: background work goes through
 * queues with retry, a DLQ, and failures flagged on the admin Errors page).
 *
 *   crons ──enqueue──▶ COST_JOBS_QUEUE (al-ummah-cost-jobs[-qa|-stage]) ──▶ queue() below
 *                          │ failure: retry with backoff (1, 2, 4, 8, 16 min), MAX_ATTEMPTS in all
 *                          ▼ last attempt failed
 *                 Errors page needs-action item (key cost-job:<job>, Retry = admin-api "cost-job")
 *                          ▼ consumer itself crashed
 *                 al-ummah-cost-jobs-dlq[-env] ──▶ dlq() flags the same item (backstop)
 *
 * Jobs are idempotent (every write is an upsert of a day or an hour), so a retry or a manual Retry
 * never double counts. With no queue bound (local dev, tests) a cron runs its jobs inline.
 * A job with no credential to use is skipped, never failed: the Costs page asks for the key.
 */
import { parseCostAlertSettings, reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { cloudflareToken, recordCollectorState, storedCredential, type CredentialEnv } from './credentials';
import { parseEnvs } from './manifest';
import { bunnyDayRow, countResendEmails, fetchBunnyMonthCharges, fetchContainers, monthBefore, ProductFetchError, resendDayRow, upsertProductRows } from './products';
import { logger } from './logger';

export const COST_JOB_VERSION = 1;
export const COST_JOB_KINDS = ['hourly', 'daily', 'containers', 'bunny', 'resend'] as const;
export type CostJobKind = (typeof COST_JOB_KINDS)[number];

export interface CostJob {
  v: typeof COST_JOB_VERSION;
  job: CostJobKind;
  /** The cron time the job was planned for (ISO); hourly/daily windows are relative to it. */
  at: string;
  /** Product jobs: the UTC day to pull. */
  day?: string;
}

/** Keep equal to max_retries + 1 of the cost-jobs consumer in wrangler*.jsonc. */
export const MAX_ATTEMPTS = 6;

export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 1800);
}

export function isCostJob(body: unknown): body is CostJob {
  if (!body || typeof body !== 'object') return false;
  const b = body as Partial<CostJob>;
  if (b.v !== COST_JOB_VERSION || typeof b.job !== 'string' || !(COST_JOB_KINDS as readonly string[]).includes(b.job)
    || typeof b.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(b.at)
    || !Number.isFinite(Date.parse(b.at))) return false;
  if (b.day === undefined) return true;
  if (typeof b.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) return false;
  const day = new Date(b.day);
  return Number.isFinite(day.getTime()) && day.toISOString().startsWith(b.day + 'T');
}

/** Errors page key of a job (one item per job and day, so Retry re-runs exactly that one). */
/**
 * The needs-action item of a job. The hourly collection is one standing item (each failed hour
 * updates it and counts up; the next good hour resolves it), not one item per hour: production
 * had 66 open "Cost collection failed" items for one cause (2026-11-18). Day jobs keep one per day.
 */
export const jobKey = (j: Pick<CostJob, 'job' | 'day' | 'at'>) => (j.job === 'hourly' ? 'cost-job:hourly' : `cost-job:${j.job}:${j.day ?? j.at.slice(0, 13)}`);

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, n: number) => dayOf(new Date(d.getTime() - n * 86_400_000));

/** What each cron plans. Hourly: collection, today's containers and Bunny. Daily: the final pass of yesterday. */
export function plannedJobs(cron: 'hourly' | 'daily', at: Date): CostJob[] {
  const iso = at.toISOString();
  const job = (kind: CostJobKind, day?: string): CostJob => ({ v: COST_JOB_VERSION, job: kind, at: iso, ...(day ? { day } : {}) });
  if (cron === 'hourly') return [job('hourly'), job('containers', dayOf(at)), job('bunny', dayOf(at))];
  return [job('daily'), job('containers', daysBefore(at, 1)), job('bunny', daysBefore(at, 1)), job('resend', daysBefore(at, 1)), job('resend', dayOf(at))];
}

export interface JobsEnv extends CredentialEnv, ErrorReporterEnv {
  COST_JOBS_QUEUE?: { sendBatch(messages: { body: CostJob; contentType?: 'json' }[]): Promise<void> };
  CLOUDFLARE_ACCOUNT_ID?: string;
  COLLECT_ENVS?: string;
}

export interface JobOutcome {
  status: 'ok' | 'skipped' | 'failed';
  rows?: number;
  detail?: string;
  /** A failure a retry will not fix (e.g. a refused key): flagged at once. */
  permanent?: boolean;
}

export type JobRunner = (job: CostJob, env: JobsEnv, ctx: ExecutionContextLike | undefined, fetchImpl: typeof fetch) => Promise<JobOutcome>;

/** Product jobs. hourly/daily are wired in by index.ts (collect.ts), so this module has no cycle. */
export async function runProductJob(job: CostJob, env: JobsEnv, fetchImpl: typeof fetch, now = new Date()): Promise<JobOutcome> {
  const day = job.day ?? dayOf(now);
  try {
    if (job.job === 'containers') {
      const { token, source } = await cloudflareToken(env);
      if (!token || !env.CLOUDFLARE_ACCOUNT_ID) return { status: 'skipped', detail: 'no Cloudflare token' };
      let rows;
      try {
        rows = await fetchContainers(token, env.CLOUDFLARE_ACCOUNT_ID, day, parseEnvs(env.COLLECT_ENVS), fetchImpl);
      } catch (error) {
        // Today's running total is refreshed every hour and yesterday's final pass runs daily: a
        // rate-limited hour is skipped, not retried into the same limit and flagged (prod
        // 2026-11-18: 23 flags for one day). The daily pass still retries and flags.
        if (error instanceof ProductFetchError && error.status === 429 && day === dayOf(now)) return { status: 'skipped', detail: 'Containers API rate-limited; next hour' };
        throw error;
      }
      await upsertProductRows(env.COSTS_DB, rows, now);
      return { status: 'ok', rows: rows.length, detail: `token ${source}` };
    }
    if (job.job === 'bunny') {
      const key = await storedCredential(env, 'bunny');
      if (!key) return { status: 'skipped', detail: 'no Bunny key' };
      const charges = await fetchBunnyMonthCharges(key, fetchImpl);
      // A day before this month's start (the daily pass of the 1st for the 31st) cannot be split from one figure
      if (day.slice(0, 7) !== dayOf(now).slice(0, 7)) return { status: 'skipped', detail: 'previous month is closed' };
      const earlier = await monthBefore(env.COSTS_DB, 'bunny', day, 'cost_usd');
      await upsertProductRows(env.COSTS_DB, [bunnyDayRow(day, charges, earlier)], now);
      return { status: 'ok', rows: 1 };
    }
    if (job.job === 'resend') {
      const key = await storedCredential(env, 'resend');
      if (!key) return { status: 'skipped', detail: 'no Resend key' };
      const { count, complete } = await countResendEmails(key, day, fetchImpl);
      const settings = parseCostAlertSettings((await env.COSTS_DB.prepare("SELECT value FROM cost_settings WHERE key = 'alerts'").first<{ value: string }>())?.value);
      const earlier = await monthBefore(env.COSTS_DB, 'resend', day, 'quantity');
      await upsertProductRows(env.COSTS_DB, [resendDayRow(day, count, earlier, settings.resendPlan)], now);
      return { status: 'ok', rows: 1, detail: complete ? undefined : 'count capped at the page limit' };
    }
    return { status: 'failed', detail: `not a product job: ${job.job}`, permanent: true };
  } catch (error) {
    const permanent = error instanceof ProductFetchError && !error.retryable;
    return { status: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300), permanent };
  }
}

async function recordRun(db: D1Database, job: CostJob, outcome: JobOutcome, attempts: number, started: Date): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO cost_job_runs (id, job, started_at, finished_at, status, attempts, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), `${job.job}${job.day ? `:${job.day}` : ''}`, started.toISOString(), new Date().toISOString(), outcome.status, attempts, outcome.detail ? outcome.detail.slice(0, 500) : null)
      .run();
  } catch (error) {
    logger.debug('[ops] Job run not recorded', { error: String(error) });
  }
}

const TITLES: Record<CostJobKind, string> = {
  hourly: 'Cost collection failed',
  daily: 'Daily cost rollup failed',
  containers: 'Containers usage could not be collected',
  bunny: 'Bunny costs could not be collected',
  resend: 'Resend usage could not be collected',
};

/** Flags a job that gave up on the Errors page, with Retry (admin-api builtin "cost-job"). */
export function flagJobFailure(env: JobsEnv, ctx: ExecutionContextLike | undefined, job: CostJob, reason: string, fetchImpl: typeof fetch): void {
  reportNeedsAction(
    'cost-monitor',
    env,
    ctx,
    {
      key: jobKey(job),
      source: 'ops',
      title: TITLES[job.job],
      message: `${job.job}${job.day ? ` for ${job.day}` : ''}: ${reason}`.slice(0, 500),
      itemType: 'ops-cost',
      itemId: jobKey(job),
      itemUrl: '/costs',
      retry: { kind: 'builtin', handler: 'cost-job', args: { job: job.job, at: job.at, ...(job.day ? { day: job.day } : {}) } },
      retryLabel: 'Run again',
    },
    fetchImpl,
  );
}

/**
 * Runs one job and says what the queue should do with it. A permanent failure or the last attempt
 * flags the admin and acks; earlier failures retry with backoff; success resolves a flagged item.
 */
export async function handleJob(
  job: CostJob,
  attempts: number,
  env: JobsEnv,
  ctx: ExecutionContextLike | undefined,
  run: JobRunner,
  fetchImpl: typeof fetch = fetch,
): Promise<'ack' | 'retry'> {
  const started = new Date();
  let outcome: JobOutcome;
  try {
    outcome = await run(job, env, ctx, fetchImpl);
  } catch (error) {
    outcome = { status: 'failed', detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
  }
  await recordRun(env.COSTS_DB, job, outcome, attempts, started);
  if (outcome.status !== 'failed') {
    if (job.job === 'hourly' || job.job === 'daily') {
      const { source } = await cloudflareToken(env).catch(() => ({ source: 'none' as const }));
      await recordCollectorState(env.COSTS_DB, { tokenSource: source, job: job.job, status: outcome.status }, new Date());
    }
    // The standing hourly item is closed by the next good hour, whatever attempt it took
    if (attempts > 1 || job.job === 'hourly') resolveNeedsAction(env, ctx, jobKey(job), fetchImpl);
    return 'ack';
  }
  if (!outcome.permanent && attempts < MAX_ATTEMPTS) {
    logger.warn('[ops] Cost job failed; will retry', { job: job.job, day: job.day, attempts, error: outcome.detail });
    return 'retry';
  }
  logger.error('[ops] Cost job failed for good', { alert: 'cost_job_failed', job: job.job, day: job.day, attempts, error: outcome.detail });
  flagJobFailure(env, ctx, job, outcome.detail ?? 'failed', fetchImpl);
  return 'ack';
}

export interface QueueMessageLike<T> {
  id: string;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/** Plans a cron's jobs onto the queue, or runs them inline where no queue is bound. */
export async function planJobs(cron: 'hourly' | 'daily', at: Date, env: JobsEnv, ctx: ExecutionContextLike | undefined, run: JobRunner, fetchImpl: typeof fetch = fetch): Promise<void> {
  const jobs = plannedJobs(cron, at);
  if (env.COST_JOBS_QUEUE) {
    try {
      await env.COST_JOBS_QUEUE.sendBatch(jobs.map((body) => ({ body, contentType: 'json' as const })));
      return;
    } catch (error) {
      logger.error('[ops] Could not queue the cost jobs; running them inline', { cron, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const job of jobs) await handleJob(job, MAX_ATTEMPTS, env, ctx, run, fetchImpl);
}

/** Queue consumer of COST_JOBS_QUEUE, and of its DLQ as the backstop. */
export async function consumeJobs(
  batch: { queue: string; messages: readonly QueueMessageLike<unknown>[] },
  env: JobsEnv,
  ctx: ExecutionContextLike | undefined,
  run: JobRunner,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const isDlq = /-dlq(-qa|-stage)?$/.test(batch.queue);
  for (const msg of batch.messages) {
    if (!isCostJob(msg.body)) {
      logger.error('[ops] Malformed cost job dropped', { id: msg.id, queue: batch.queue });
      msg.ack();
      continue;
    }
    if (isDlq) {
      flagJobFailure(env, ctx, msg.body, 'the job was dead-lettered', fetchImpl);
      msg.ack();
      continue;
    }
    const verdict = await handleJob(msg.body, msg.attempts, env, ctx, run, fetchImpl);
    if (verdict === 'retry') msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
    else msg.ack();
  }
}
