import type { Env, HealthStatus, Metrics, PublishEvent } from './types';
import { getLastRun } from './locks';
import { logger } from './lib/logger';

/**
 * Report run metrics as a structured log line.
 *
 * These used to be sent to the processor's queue as ad-hoc objects
 * ({ type: 'SCHEDULER_METRICS', ... }). They are not AlUmmahMessages, so the
 * processor rejected every one as "Invalid message structure": a queue write,
 * read and delete plus a processor invocation for nothing. Workers Logs is
 * where they are read.
 */
export function reportMetrics(metrics: { processed: number; failed: number; duration: number }): void {
  logger.debug('[Scheduler] Run metrics', { event: 'SCHEDULER_METRICS', ...metrics });
}

/**
 * Log a publish event (success, failure, retry) as a structured log line.
 * Not sent to the queue, for the same reason as reportMetrics.
 */
export function logEvent(event: PublishEvent | Record<string, unknown>): void {
  if (event.type === 'SCHEDULED_PUBLISH_FAILURE') logger.warn(`[Scheduler] ${String(event.type)}`, event);
  else logger.debug(`[Scheduler] ${String(event.type)}`, event);
}

/**
 * Check scheduler health status
 * @param env Environment bindings
 * @returns Health status object
 */
export async function checkHealth(env: Env): Promise<HealthStatus> {
  try {
    // Check if scheduler ran in last 2 minutes
    const lastRun = await getLastRun(env.SCHEDULER_LOCKS);
    const isHealthy = lastRun !== null && (Date.now() - lastRun) < 120000;

    // Get queue depth (approximate)
    const queueDepth = await getQueueDepth(env);

    // Get failure rate from metrics
    const failureRate = await getFailureRate(env);

    return {
      healthy: isHealthy,
      lastRun: lastRun ? new Date(lastRun).toISOString() : undefined,
      queueDepth,
      failureRate,
    };
  } catch (error) {
    logger.error('Failed to check health:', error);
    return {
      healthy: false,
      queueDepth: 0,
      failureRate: 0,
    };
  }
}

/**
 * Get approximate queue depth
 * @param env Environment bindings
 * @returns Queue depth
 */
async function getQueueDepth(env: Env): Promise<number> {
  try {
    const metrics = await env.SCHEDULER_METRICS.get('queue_depth');
    return metrics ? parseInt(metrics, 10) : 0;
  } catch (error) {
    logger.error('Failed to get queue depth:', error);
    return 0;
  }
}

/**
 * Get failure rate from recent metrics
 * @param env Environment bindings
 * @returns Failure rate (0-1)
 */
async function getFailureRate(env: Env): Promise<number> {
  try {
    const metricsJson = await env.SCHEDULER_METRICS.get(dailyMetricsKey());
    if (!metricsJson) return 0;

    const metrics: Metrics = JSON.parse(metricsJson);
    const total = metrics.publishedToday + metrics.failedToday;
    if (total === 0) return 0;

    return metrics.failedToday / total;
  } catch (error) {
    logger.error('Failed to get failure rate:', error);
    return 0;
  }
}

/** KV key of one UTC day's counters (a new key each day, so the counts reset daily). */
export function dailyMetricsKey(at: Date = new Date()): string {
  return `daily_metrics:${at.toISOString().slice(0, 10)}`;
}

export interface RunMetrics {
  published: number;
  failed: number;
  /** Sum of publish delays (seconds) of the published videos */
  delaySeconds: number;
  /** Runs that ended early on a transient R2/KV error (storage-outage.ts) */
  storageErrors?: number;
}

/**
 * Adds one run's counts to today's metrics (SCALABILITY-AUDIT SC-4): the run
 * counts in memory and writes once, instead of a KV read-modify-write per
 * video from up to ten parallel publishes (lost counts, 429s on the key).
 */
export async function recordRunMetrics(env: Env, run: RunMetrics, at: Date = new Date()): Promise<void> {
  if (run.published === 0 && run.failed === 0 && !run.storageErrors) return;
  try {
    const key = dailyMetricsKey(at);
    const stored = await env.SCHEDULER_METRICS.get(key);
    const metrics: Metrics = stored
      ? JSON.parse(stored)
      : { scheduledVideosCount: 0, publishedToday: 0, failedToday: 0, averageDelay: 0, queueDepth: 0 };
    const totalDelay = metrics.averageDelay * metrics.publishedToday + run.delaySeconds;
    metrics.publishedToday += run.published;
    metrics.failedToday += run.failed;
    if (run.storageErrors) metrics.storageErrorsToday = (metrics.storageErrorsToday ?? 0) + run.storageErrors;
    metrics.averageDelay = metrics.publishedToday > 0 ? totalDelay / metrics.publishedToday : 0;
    await env.SCHEDULER_METRICS.put(key, JSON.stringify(metrics), { expirationTtl: 2 * 86400 });
  } catch (error) {
    logger.error('Failed to update daily metrics:', error);
  }
}

/**
 * Alert for critical issues: a structured error log (`alert: scheduler_error`),
 * searchable in Workers Logs. No longer sent to the processor's queue, which
 * rejected it as an invalid message.
 */
export function sendAlert(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`ALERT: ${message}`, {
    alert: 'scheduler_error',
    event: 'SCHEDULER_ALERT',
    stack: error instanceof Error ? error.stack : undefined,
  });
}
