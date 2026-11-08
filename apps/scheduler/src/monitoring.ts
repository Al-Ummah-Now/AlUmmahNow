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
  logger.info('[Scheduler] Run metrics', { event: 'SCHEDULER_METRICS', ...metrics });
}

/**
 * Log a publish event (success, failure, retry) as a structured log line.
 * Not sent to the queue, for the same reason as reportMetrics.
 */
export function logEvent(event: PublishEvent | Record<string, unknown>): void {
  if (event.type === 'SCHEDULED_PUBLISH_FAILURE') logger.warn(`[Scheduler] ${String(event.type)}`, event);
  else logger.info(`[Scheduler] ${String(event.type)}`, event);
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
    const metricsJson = await env.SCHEDULER_METRICS.get('daily_metrics');
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

/**
 * Update daily metrics
 * @param env Environment bindings
 * @param type Metric type ('success' or 'failure')
 * @param delay Publish delay in seconds (optional)
 */
export async function updateDailyMetrics(
  env: Env,
  type: 'success' | 'failure',
  delay?: number
): Promise<void> {
  try {
    const metricsJson = await env.SCHEDULER_METRICS.get('daily_metrics');
    let metrics: Metrics = {
      scheduledVideosCount: 0,
      publishedToday: 0,
      failedToday: 0,
      averageDelay: 0,
      queueDepth: 0,
    };

    if (metricsJson) {
      metrics = JSON.parse(metricsJson);
    }

    if (type === 'success') {
      metrics.publishedToday += 1;
      if (delay !== undefined) {
        // Update average delay using incremental average
        const totalDelay = metrics.averageDelay * (metrics.publishedToday - 1) + delay;
        metrics.averageDelay = totalDelay / metrics.publishedToday;
      }
    } else {
      metrics.failedToday += 1;
    }

    await env.SCHEDULER_METRICS.put(
      'daily_metrics',
      JSON.stringify(metrics),
      { expirationTtl: 86400 } // 24 hours
    );
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

/**
 * Initialize metrics on startup
 * @param env Environment bindings
 */
export async function initializeMetrics(env: Env): Promise<void> {
  try {
    const metricsJson = await env.SCHEDULER_METRICS.get('daily_metrics');
    if (!metricsJson) {
      const initialMetrics: Metrics = {
        scheduledVideosCount: 0,
        publishedToday: 0,
        failedToday: 0,
        averageDelay: 0,
        queueDepth: 0,
      };

      await env.SCHEDULER_METRICS.put(
        'daily_metrics',
        JSON.stringify(initialMetrics),
        { expirationTtl: 86400 }
      );
    }
  } catch (error) {
    logger.error('Failed to initialize metrics:', error);
  }
}
