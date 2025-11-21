import type { Env, HealthStatus, Metrics, PublishEvent } from './types';
import { getLastRun } from './locks';

/**
 * Report metrics to queue for analytics
 * @param queue Queue binding
 * @param metrics Metrics data
 */
export async function reportMetrics(
  queue: Queue,
  metrics: {
    processed: number;
    failed: number;
    duration: number;
  }
): Promise<void> {
  try {
    await queue.send({
      type: 'SCHEDULER_METRICS',
      timestamp: new Date().toISOString(),
      ...metrics,
    });

    console.log(`Reported metrics: ${metrics.processed} processed, ${metrics.failed} failed, ${metrics.duration}ms duration`);
  } catch (error) {
    console.error('Failed to report metrics:', error);
  }
}

/**
 * Log publish event to queue
 * @param queue Queue binding
 * @param event Publish event data
 */
export async function logEvent(
  queue: Queue,
  event: PublishEvent
): Promise<void> {
  try {
    await queue.send(event);
    console.log(`Logged event: ${event.type} for video ${event.videoId}`);
  } catch (error) {
    console.error('Failed to log event:', error);
  }
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
    console.error('Failed to check health:', error);
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
    console.error('Failed to get queue depth:', error);
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
    console.error('Failed to get failure rate:', error);
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
    console.error('Failed to update daily metrics:', error);
  }
}

/**
 * Send alert for critical issues
 * @param env Environment bindings
 * @param error Error or message
 */
export async function sendAlert(
  env: Env,
  error: unknown
): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`ALERT: ${message}`);

    // Log to queue for external monitoring
    await env.QUEUE.send({
      type: 'SCHEDULER_ALERT',
      timestamp: new Date().toISOString(),
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  } catch (alertError) {
    console.error('Failed to send alert:', alertError);
  }
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
    console.error('Failed to initialize metrics:', error);
  }
}
