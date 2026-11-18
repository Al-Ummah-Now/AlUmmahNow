/**
 * al-ummah-cost-monitor: the scheduled collector of platform analytics and costs for the videos
 * admin (docs/admin/LIVE_OPS.md Part A, docs/cost-monitoring/README.md §7, COST-1).
 * No public route and no workers.dev URL: it only runs on its crons and its queue.
 *
 *   10 * * * *   hourly: plans collection (Cloudflare GraphQL → ops_hourly, rollup, thresholds),
 *                today's Containers usage and Bunny charges
 *   30 3 * * *   daily: plans discovery + yesterday's final rollup + retention, and yesterday's
 *                Containers, Bunny and Resend
 *
 * The crons only enqueue jobs on COST_JOBS_QUEUE; queue() runs them with retry, backoff and a DLQ,
 * and a job that gives up is flagged on the admin Errors page (src/jobs.ts).
 */
import { withLogging } from '@al-ummah/logger';
import { runDaily, runHourly, type CollectorEnv } from './collect';
import { consumeJobs, planJobs, runProductJob, type JobOutcome, type JobRunner, type QueueMessageLike } from './jobs';

export const DAILY_CRON = '30 3 * * *';

/** Runs any job: collection and rollup (collect.ts) or a product pull (jobs.ts). */
export const runJob: JobRunner = async (job, env, ctx, fetchImpl): Promise<JobOutcome> => {
  const at = new Date(job.at);
  const e = env as CollectorEnv;
  if (job.job === 'hourly') {
    const o = await runHourly(e, ctx, at, fetchImpl);
    if (o.status === 'failed') return { status: 'failed', detail: `hourly collection failed: ${o.error ?? 'no reason recorded'}` };
    return { status: o.status === 'skipped' ? 'skipped' : 'ok', rows: o.rows, detail: o.status === 'partial' ? 'some datasets failed' : undefined };
  }
  if (job.job === 'daily') {
    const o = await runDaily(e, at, fetchImpl);
    return o.status === 'failed' ? { status: 'failed', detail: 'daily rollup failed' } : { status: 'ok', rows: o.rolled };
  }
  return runProductJob(job, env, fetchImpl);
};

async function scheduled(controller: ScheduledController, env: CollectorEnv, ctx: ExecutionContext): Promise<void> {
  const cron = controller.cron === DAILY_CRON ? 'daily' : 'hourly';
  ctx.waitUntil(planJobs(cron, new Date(controller.scheduledTime), env, ctx, runJob));
}

async function queue(batch: { queue: string; messages: readonly QueueMessageLike<unknown>[] }, env: CollectorEnv, ctx: ExecutionContext): Promise<void> {
  await consumeJobs(batch, env, ctx, runJob);
}

/** Nothing is served: the worker has no route; a service binding gets a plain 404. */
function fetch(): Response {
  return new Response('Not found', { status: 404 });
}

export default withLogging({ fetch, scheduled, queue } as never);
