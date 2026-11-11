import { reportServerError } from '@al-ummah/shared-types';
import type { Env } from './types';
import { recordRunMetrics } from './monitoring';
import { logger } from './lib/logger';
import { storageErrorCode } from './lib/storage-retry';

/**
 * Runs that ended early on a transient R2/KV error.
 *
 * Such a run loses nothing: the next one (a minute later) scans the same
 * entries. So one is a warning, not an error report. Only an outage that
 * lasts ESCALATE_AFTER consecutive runs goes to the admin Errors page (once,
 * then once an hour while it lasts). The count lives in SCHEDULER_LOCKS and
 * is cleared by the next run that gets through.
 */
export const OUTAGE_KEY = 'storage_outage';
export const ESCALATE_AFTER = 5;
/** While the outage lasts, report again every this many runs (one hour at one run a minute) */
const REPORT_EVERY = 60;

interface OutageState {
  count: number;
  since: string;
  code?: string;
}

async function readOutage(env: Env): Promise<OutageState | null> {
  const raw = await env.SCHEDULER_LOCKS.get(OUTAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OutageState;
  } catch {
    return null;
  }
}

/** Records one run lost to a transient storage error; returns the consecutive count. */
export async function recordStorageOutage(env: Env, ctx: ExecutionContext | undefined, error: unknown, now: Date = new Date()): Promise<number> {
  const code = storageErrorCode(error);
  let state: OutageState = { count: 1, since: now.toISOString(), code };
  try {
    const previous = await readOutage(env);
    if (previous) state = { count: previous.count + 1, since: previous.since, code };
    // Expires on its own if the scheduler stops running, so a stale count never escalates later
    await env.SCHEDULER_LOCKS.put(OUTAGE_KEY, JSON.stringify(state), { expirationTtl: 3600 });
  } catch (kvError) {
    // KV down as well: this run counts as the first; the warning below still goes out
    logger.warn('[Scheduler] Could not record the storage outage count', { error: kvError });
  }

  logger.warn('[Scheduler] Run ended early: storage temporarily unavailable; next run retries', {
    event: 'SCHEDULER_STORAGE_UNAVAILABLE',
    code,
    consecutive: state.count,
    since: state.since,
    error,
  });
  await recordRunMetrics(env, { published: 0, failed: 0, delaySeconds: 0, storageErrors: 1 }, now);

  if (state.count >= ESCALATE_AFTER && (state.count - ESCALATE_AFTER) % REPORT_EVERY === 0) {
    const message = error instanceof Error ? error.message : String(error);
    reportServerError('scheduler', env, ctx, new Error(`Scheduler: storage unavailable for ${state.count} consecutive runs: ${message}`), {
      route: 'cron:scheduler',
      extra: { consecutive: state.count, since: state.since, code: code ?? null },
    });
  }
  return state.count;
}

/** A run got through: the outage, if any, is over. */
export async function clearStorageOutage(env: Env): Promise<void> {
  try {
    const previous = await readOutage(env);
    if (!previous) return;
    await env.SCHEDULER_LOCKS.delete(OUTAGE_KEY);
    logger.info('[Scheduler] Storage available again', { event: 'SCHEDULER_STORAGE_RECOVERED', consecutive: previous.count, since: previous.since });
  } catch (error) {
    logger.warn('[Scheduler] Could not clear the storage outage count', { error });
  }
}
