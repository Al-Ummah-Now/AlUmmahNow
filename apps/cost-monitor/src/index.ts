/**
 * al-ummah-cost-monitor: the scheduled collector of platform analytics for the
 * videos admin (docs/admin/LIVE_OPS.md Part A, docs/cost-monitoring/README.md §7).
 * No public route and no workers.dev URL: it only runs on its crons.
 *
 *   10 * * * *   hourly: Cloudflare GraphQL → ops_hourly, rollup, thresholds
 *   30 3 * * *   daily: yesterday's final rollup, 13-month retention
 */
import { withLogging } from '@al-ummah/logger';
import { runDaily, runHourly, type CollectorEnv } from './collect';

export const DAILY_CRON = '30 3 * * *';

async function scheduled(controller: ScheduledController, env: CollectorEnv, ctx: ExecutionContext): Promise<void> {
  if (controller.cron === DAILY_CRON) {
    ctx.waitUntil(runDaily(env, new Date(controller.scheduledTime)).then(() => undefined));
    return;
  }
  ctx.waitUntil(runHourly(env, ctx, new Date(controller.scheduledTime)).then(() => undefined));
}

/** Nothing is served: the worker has no route; a service binding gets a plain 404. */
function fetch(): Response {
  return new Response('Not found', { status: 404 });
}

export default withLogging({ fetch, scheduled });
