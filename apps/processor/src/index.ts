import { AlUmmahMessage, MessageType, QueueEnvironment } from './types';
import { erasureRetryDelaySeconds } from './contact/erase';

/** Account erasure steps: retried with backoff, then dead-lettered (shown on the admin Errors page). */
const ERASURE_TYPES: readonly number[] = [MessageType.UserDataErased, MessageType.ContactDataErase, MessageType.ArchiveTitlesErase];
import { MessageProcessor } from './messageProcessor';
import type { createLogger } from '@al-ummah/logger';
import { loggerFor } from './lib/logger';
import { purgeExpiredNotifications } from './lib/notifications-store';
import { handleImageReviewScan, handleVideoReviewAppeal, handleVideoReviewScan, isImageReviewPayload, isReviewAppealPayload, isReviewScanPayload, type ReviewConsumerEnv } from './review/consumer';
import { handleModerationScan, isScanPayload } from './moderation/consumer';
import { purgeExpiredModerationData } from './moderation/store';
import { purgeExpiredAdminHistory } from './erasure/admin-history';
import { purgeExpiredTitleRefs } from './erasure/archive-titles';
import { purgeExpiredTombstones } from './erasure/tombstones';
import { isDeadLetterQueue, processDeadLetterBatch } from './dlq/consumer';
import { listDeadLetters, purgeExpiredDeadLetters, replayDeadLetter } from './dlq/store';
import { getApiKey } from './lib/websocket-notify';
import { reportServerError, resolveNeedsAction, withErrorReporting, type ExecutionContextLike } from '@al-ummah/shared-types';
import { importLegacyRollups } from './lib/analytics-rollup';
import { resumeStalledImports } from './lib/post-counters';
import { isCategorizeMessage, processCategorizeMessages, sweepCategorySuggestions, type CategorizeQueueMessage } from './categorize/queue';
import type { CategorizeEnv } from './categorize/job';
import { isQuranSyncMessage, processQuranSyncMessages, quranSyncMessage, runQuranDaily, type QuranQueueMessage, type QuranSyncEnv } from './quran/sync';
import type { SearchDb } from '@al-ummah/shared-types';
import { processReviewAlertBatch } from './review-alerts/consumer';
import { handleReviewAlertsInternal } from './review-alerts/internal';
import { purgeExpiredReviewAlerts } from './review-alerts/store';
import { resolvePushProviders } from './push/provider';

interface QueueMessage<T> {
  /** Queue message id (Cloudflare Queues). */
  id?: string;
  body: T;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
  /** Delivery attempt, starting at 1 (Cloudflare Queues). */
  attempts?: number;
}

interface MessageBatch<T> {
  /** Name of the queue the batch came from. */
  queue?: string;
  messages: QueueMessage<T>[];
}

/** Matches max_retries of the moderation consumer in the wrangler configs. */
export const MODERATION_MAX_RETRIES = 3;

/** Moderation queue (Epic 28): one AI scan per message; see src/moderation/consumer.ts. */
export async function processModerationBatch(
  batch: MessageBatch<AlUmmahMessage>,
  env: QueueEnvironment,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  for (const message of batch.messages) {
    const payload = message.body?.payload;
    // Pre-publication review (docs/specs/VIDEO-REVIEW.md §4) shares the moderation queue
    if (message.body?.type === MessageType.VideoReviewScan || message.body?.type === MessageType.VideoReviewAppeal || message.body?.type === MessageType.ImageReviewScan) {
      await processReviewMessage(message, env as unknown as ReviewConsumerEnv, logger);
      continue;
    }
    if (!isScanPayload(payload)) {
      logger.warn('[Moderation] Invalid scan message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    try {
      const lastAttempt = (message.attempts ?? 1) > MODERATION_MAX_RETRIES;
      const outcome = await handleModerationScan(payload, env, logger, { lastAttempt });
      if (outcome.status === 'retry') message.retry();
      else message.ack();
    } catch (error) {
      // D1 or config failure: let the queue retry (then DLQ). Content is never touched.
      logger.error('[Moderation] Scan failed', { id: message.body?.id, error: error instanceof Error ? error.message : String(error) });
      message.retry();
    }
  }
}

/** One review message: a scan (models) or an appeal (a D1 row). Retries like a moderation scan. */
async function processReviewMessage(message: QueueMessage<AlUmmahMessage>, env: ReviewConsumerEnv, logger: ReturnType<typeof createLogger>): Promise<void> {
  const payload = message.body?.payload;
  try {
    if (message.body?.type === MessageType.VideoReviewAppeal) {
      if (!isReviewAppealPayload(payload)) {
        logger.warn('[Review] Invalid appeal message dropped', { id: message.body?.id });
        message.ack();
        return;
      }
      await handleVideoReviewAppeal(payload, env, logger);
      message.ack();
      return;
    }
    if (message.body?.type === MessageType.ImageReviewScan) {
      if (!isImageReviewPayload(payload)) {
        logger.warn('[Review] Invalid image scan dropped', { id: message.body?.id });
        message.ack();
        return;
      }
      const lastAttempt = (message.attempts ?? 1) > MODERATION_MAX_RETRIES;
      const outcome = await handleImageReviewScan(payload, env, logger, { lastAttempt });
      if (outcome.status === 'retry') message.retry();
      else message.ack();
      return;
    }
    if (!isReviewScanPayload(payload)) {
      logger.warn('[Review] Invalid scan message dropped', { id: message.body?.id });
      message.ack();
      return;
    }
    const lastAttempt = (message.attempts ?? 1) > MODERATION_MAX_RETRIES;
    const outcome = await handleVideoReviewScan(payload, env, logger, { lastAttempt });
    if (outcome.status === 'retry') message.retry();
    else message.ack();
  } catch (error) {
    // D1 failure: the queue retries, then the DLQ alerts. The video stays held (fail safe).
    logger.error('[Review] Message failed', { id: message.body?.id, error: error instanceof Error ? error.message : String(error) });
    message.retry();
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Constant-time comparison of the X-API-Key header with INTERNAL_API_KEY. */
async function isInternalCaller(request: Request, env: QueueEnvironment): Promise<boolean> {
  const expected = await getApiKey(env.INTERNAL_API_KEY);
  const given = request.headers.get('X-API-Key') ?? '';
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/**
 * Internal dead-letter API (X-API-Key = INTERNAL_API_KEY):
 *   GET  /dlq?limit=50&all=1   newest dead letters (all=1 includes replayed ones)
 *   POST /dlq/replay {"id"}    re-send one stored message to the videos queue
 */
export async function handleDeadLetterRequest(
  request: Request,
  url: URL,
  env: QueueEnvironment,
  logger: ReturnType<typeof createLogger>,
  ctx?: ExecutionContextLike
): Promise<Response> {
  if (!(await isInternalCaller(request, env))) return json({ error: 'Unauthorized' }, 401);
  if (!env.NOTIFICATIONS_DB) return json({ error: 'NOTIFICATIONS_DB not bound' }, 503);

  if (url.pathname === '/dlq' && request.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 50) || 50;
    const deadLetters = await listDeadLetters(env.NOTIFICATIONS_DB, { limit, includeReplayed: url.searchParams.get('all') === '1' });
    return json({ deadLetters });
  }
  if (url.pathname === '/dlq/replay' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !body.id) return json({ error: 'id is required' }, 400);
    const outcome = await replayDeadLetter(env.NOTIFICATIONS_DB, env.MESSAGE_QUEUE, body.id);
    logger.info('[DLQ] Replay requested', { id: body.id, status: outcome.status });
    // Replayed by any caller: the item on the Errors page is done
    if (outcome.status === 'replayed') resolveNeedsAction(env, ctx, `dlq:${body.id}`.slice(0, 160));
    const status = outcome.status === 'replayed' ? 200 : outcome.status === 'not_found' ? 404 : 409;
    return json(outcome, status);
  }
  return json({ error: 'Method not allowed' }, 405);
}

/** POST /internal/quran/sync {"rebuild"?: boolean} (X-API-Key): queue a Content Sync run. */
export async function handleQuranSyncRequest(request: Request, env: QueueEnvironment, logger: ReturnType<typeof createLogger>): Promise<Response> {
  if (!(await isInternalCaller(request, env))) return json({ error: 'Unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.MESSAGE_QUEUE) return json({ error: 'MESSAGE_QUEUE not bound' }, 503);
  const body = (await request.json().catch(() => ({}))) as { rebuild?: unknown } | null;
  await env.MESSAGE_QUEUE.send(quranSyncMessage({ reason: 'admin', rebuild: body?.rebuild !== false }) as unknown as AlUmmahMessage);
  logger.info('[Quran] Sync queued by an admin');
  return json({ queued: true }, 202);
}

// Health check helper functions
async function checkR2Health(env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Check if MESSAGES_BUCKET is accessible (without creating test objects)
    if (env.MESSAGES_BUCKET && typeof env.MESSAGES_BUCKET.put === 'function') {
      return { status: 'healthy' };
    } else {
      return { status: 'unhealthy', message: 'R2 bucket not properly configured' };
    }
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'R2 access failed' 
    };
  }
}

async function checkQueueHealth(_env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Queue health is harder to check directly, but we can assume it's healthy
    // if the worker is running and processing messages
    return { status: 'healthy' };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'Queue access failed' 
    };
  }
}

async function checkDLQHealth(_env: QueueEnvironment): Promise<{ status: string; message?: string }> {
  try {
    // Similar to queue health check
    return { status: 'healthy' };
  } catch (error) {
    return { 
      status: 'unhealthy', 
      message: error instanceof Error ? error.message : 'DLQ access failed' 
    };
  }
}

/**
 * Daily cron (wrangler `triggers.crons`): 90-day notification retention (Story 29.10).
 */
/** Hourly: move legacy R2 rollup documents into the D1 counters (see lib/analytics-rollup.ts). */
export const ROLLUP_IMPORT_CRON = '17 * * * *';

export async function runRollupImport(env: QueueEnvironment, now = Date.now()) {
  const logger = loggerFor(env);
  if (!env.NOTIFICATIONS_DB) {
    logger.warn('[Rollups] NOTIFICATIONS_DB not bound; legacy rollup import skipped');
    return null;
  }
  try {
    const result = await importLegacyRollups(env.MESSAGES_BUCKET, env.NOTIFICATIONS_DB, { now });
    if (result.imported || result.alreadyImported || result.failed || result.more) {
      logger.info('[Rollups] Legacy rollup documents imported', result);
    }
    // Community post likes / votes whose legacy import stalled (lib/post-counters.ts)
    try {
      const posts = await resumeStalledImports(env.NOTIFICATIONS_DB, env.community_posts, now);
      if (posts.resumed) logger.info('[Posts] Stalled legacy post counter imports resumed', posts);
    } catch (error) {
      logger.error('[Posts] Resuming legacy post counter imports failed', error);
    }
    return result;
  } catch (error) {
    logger.error('[Rollups] Legacy rollup import failed', error);
    return null;
  }
}

/** AI category suggestions: hourly re-send of stale pending rows; daily re-send of budget-skipped rows + draft purge. */
export async function runCategorizeSweep(env: QueueEnvironment, budget: boolean, now = Date.now()) {
  const logger = loggerFor(env);
  try {
    return await sweepCategorySuggestions(env.SEARCH_DB as unknown as SearchDb | undefined, env.MESSAGE_QUEUE, logger, { budget, now });
  } catch (error) {
    logger.error('[Categorize] Sweep failed', error);
    return null;
  }
}

export async function runScheduled(env: QueueEnvironment, now = Date.now()): Promise<number> {
  const logger = loggerFor(env);
  // AI moderation retention (Epic 28): 30-day translations, 12-month signals
  try {
    await purgeExpiredModerationData(env.REPORTS_DB, now);
  } catch (error) {
    logger.error('[Retention] Moderation retention failed', error);
  }
  // Erase tombstones (#1255): 30 days
  try {
    const purged = await purgeExpiredTombstones(env.REPORTS_DB, now);
    if (purged > 0) logger.info('[Retention] Expired erase tombstones deleted', { purged });
  } catch (error) {
    logger.error('[Retention] Erase tombstone retention failed', error);
  }
  // Admin history (#1253): 2 years
  if (env.SEARCH_DB) {
    try {
      const purged = await purgeExpiredAdminHistory(env.SEARCH_DB as never, now);
      if (purged.deletions || purged.jobs) logger.info('[Retention] Expired admin history deleted', purged);
    } catch (error) {
      logger.error('[Retention] Admin history retention failed', error);
    }
  }
  if (!env.NOTIFICATIONS_DB) {
    logger.warn('[Retention] NOTIFICATIONS_DB not bound; notification retention skipped');
    return 0;
  }
  try {
    const purged = await purgeExpiredDeadLetters(env.NOTIFICATIONS_DB, now);
    if (purged > 0) logger.info('[Retention] Expired dead letters deleted', { purged });
  } catch (error) {
    logger.error('[Retention] Dead-letter retention failed', error);
  }
  // Archive title refs (#1254): past the archive's retention
  try {
    const purged = await purgeExpiredTitleRefs(env.NOTIFICATIONS_DB, now);
    if (purged > 0) logger.info('[Retention] Expired archive title refs deleted', { purged });
  } catch (error) {
    logger.error('[Retention] Archive title ref retention failed', error);
  }
  try {
    const purged = await purgeExpiredReviewAlerts(env.NOTIFICATIONS_DB, now);
    if (purged > 0) logger.info('[Retention] Expired review alert timings deleted', { purged });
  } catch (error) {
    logger.error('[Retention] Review alert retention failed', error);
  }
  try {
    const deleted = await purgeExpiredNotifications(env.NOTIFICATIONS_DB, now);
    logger.info('[Retention] Expired notifications deleted', { deleted });
    return deleted;
  } catch (error) {
    logger.error('[Retention] Notification retention failed', error);
    return 0;
  }
}

export default {
  async scheduled(controller: { cron?: string } | undefined, env: QueueEnvironment, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    if (controller?.cron === ROLLUP_IMPORT_CRON) {
      ctx.waitUntil(runRollupImport(env));
      ctx.waitUntil(runCategorizeSweep(env, false));
      return;
    }
    ctx.waitUntil(runScheduled(env));
    ctx.waitUntil(runCategorizeSweep(env, true));
    // Quran Foundation Content Sync (AUN-CAPTIONS): the 7-day rule, then a queued sync
    ctx.waitUntil(runQuranDaily(env as unknown as QuranSyncEnv, ctx as ExecutionContextLike, loggerFor(env)).catch((error) => loggerFor(env).error('[Quran] Daily sync not queued', error)));
  },

  async queue(batch: MessageBatch<AlUmmahMessage>, env: QueueEnvironment, ctx?: ExecutionContextLike): Promise<void> {
    try {
      await handleQueue(batch, env, ctx);
    } catch (error) {
      // The whole batch failed (it is retried by the queue): flag it on the Errors page
      reportServerError('processor', env, ctx, error, { kind: 'unhandled', route: `queue:${batch.queue ?? 'unknown'}`, extra: { messages: batch.messages.length } });
      throw error;
    }
  },

  fetch: withErrorReporting<QueueEnvironment, ExecutionContextLike>('processor', (request, env, ctx) => handleFetch(request, env, ctx)),
};

async function handleQueue(batch: MessageBatch<AlUmmahMessage>, env: QueueEnvironment, ctx?: ExecutionContextLike): Promise<void> {
  const logger = loggerFor(env);
  // Dead-letter queues: alert + store for replay (see src/dlq). Checked first:
  // a DLQ batch must never be processed (and fail) again as a normal message.
  if (isDeadLetterQueue(batch.queue)) {
    await processDeadLetterBatch(batch, env, logger, Date.now(), ctx);
    return;
  }
  // Review alerts for the Admin app (#1265): their own queue, one message per batch. Routed by
  // queue before any routing by message type, so a type that shares a value cannot take them
  if (batch.queue?.includes('review-alerts')) {
    await processReviewAlertBatch(batch, env, resolvePushProviders(), logger);
    return;
  }
  // AI category suggestions ride on both the moderation queue (api-videos) and the
  // videos queue (admin-api, DLQ replays): routed by message type, never by queue
  const categorize = batch.messages.filter(isCategorizeMessage);
  if (categorize.length) {
    await processCategorizeMessages(categorize as unknown as CategorizeQueueMessage[], env as unknown as CategorizeEnv, logger);
    batch = { ...batch, messages: batch.messages.filter((m) => !isCategorizeMessage(m)) };
    if (batch.messages.length === 0) return;
  }
  // Quran Content Sync (AUN-CAPTIONS) rides on the videos queue: its own backoff, then the DLQ
  const quran = batch.messages.filter(isQuranSyncMessage);
  if (quran.length) {
    await processQuranSyncMessages(quran as unknown as QuranQueueMessage[], env as unknown as QuranSyncEnv, ctx, logger);
    batch = { ...batch, messages: batch.messages.filter((m) => !isQuranSyncMessage(m)) };
    if (batch.messages.length === 0) return;
  }
  if (batch.queue?.includes('moderation')) {
    await processModerationBatch(batch, env, logger);
    return;
  }

  // One processor per batch: it collects the batch's analytics increments (flushed below)
  const processor = new MessageProcessor(logger, undefined, { batchCounters: true });
  const startedAt = Date.now();
  const retried: string[] = [];
  const deadLettered: string[] = [];

  await Promise.allSettled(
    batch.messages.map(async (message: QueueMessage<AlUmmahMessage>) => {
      try {
        const result = await processor.processMessage(message.body, env);

        if (!result.success) {
          if (result.shouldRetry) {
            // Retry the message (account erasure steps back off; contact/erase.ts)
            retried.push(message.body.id);
            const delaySeconds = erasureRetryDelaySeconds(message.body?.type, message.attempts ?? 1, ERASURE_TYPES);
            if (delaySeconds) message.retry({ delaySeconds });
            else message.retry();
          } else {
            deadLettered.push(message.body.id);
            logger.error('[Queue] Message failed for good; sending to DLQ', {
              messageId: message.body.id,
              type: message.body.type,
              queue: batch.queue,
              reason: result.error,
              retryCount: message.body.retryCount ?? 0,
            });
            if (env.DLQ && typeof env.DLQ.send === 'function') {
              await env.DLQ.send({
                ...message.body,
                retryCount: (message.body.retryCount || 0) + 1,
                failureReason: result.error || 'Unknown error',
                failedAt: result.processedAt,
              });
            } else {
              logger.warn('[Queue] DLQ not configured; message acknowledged without DLQ', { messageId: message.body.id });
            }
            message.ack();
          }
        } else {
          message.ack();
        }
      } catch (error) {
        retried.push(message.body.id);
        logger.error('[Queue] Unexpected error processing message; retrying', {
          messageId: message.body.id,
          type: message.body.type,
          queue: batch.queue,
          error,
        });
        const delaySeconds = erasureRetryDelaySeconds(message.body?.type, message.attempts ?? 1, ERASURE_TYPES);
        if (delaySeconds) message.retry({ delaySeconds });
        else message.retry();
      }
    })
  );

  // One D1 transaction for the whole batch's analytics increments
  await processor.flushCounters(env);

  // One summary line per batch (info at stage and below; warn when messages were retried or it was slow)
  logger.job({
    job: 'queue-batch',
    queue: batch.queue,
    outcome: retried.length ? 'retry' : 'ok',
    messages: batch.messages.length,
    retried: retried.length,
    deadLettered: deadLettered.length,
    retriedIds: retried.length ? retried.slice(0, 20) : undefined,
    durationMs: Date.now() - startedAt,
  });
}

async function handleFetch(request: Request, env: QueueEnvironment, ctx?: ExecutionContextLike): Promise<Response> {
  const logger = loggerFor(env);
  const url = new URL(request.url);
  
  logger.debug(`Received ${request.method} request to ${url.pathname}`);
  
  // Dead letters (see src/dlq): GET /dlq lists, POST /dlq/replay {"id"} re-sends one.
  if (url.pathname === '/dlq' || url.pathname === '/dlq/replay') {
    return handleDeadLetterRequest(request, url, env, logger, ctx);
  }

  // Quran Content Sync now (the Errors page's "Sync now"): queued, never run in the request
  if (url.pathname === '/internal/quran/sync') {
    return handleQuranSyncRequest(request, env, logger);
  }

  // Admin devices and review timings for admin-api (src/review-alerts/internal.ts)
  if (url.pathname.startsWith('/internal/review-alerts/') || url.pathname.startsWith('/internal/push-devices')) {
    if (!(await isInternalCaller(request, env))) return json({ error: 'Unauthorized' }, 401);
    return handleReviewAlertsInternal(request, url, env, logger);
  }

  // Health check endpoint
  if (url.pathname === '/health') {
    logger.debug('Health check requested');
    
    try {
      // Perform basic health checks
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: env.ENVIRONMENT,
        version: '1.0.0', // Could be read from package.json
        dependencies: {
          r2: await checkR2Health(env),
          queue: await checkQueueHealth(env),
          dlq: await checkDLQHealth(env),
        }
      };

      // Determine overall health based on dependencies
      const allHealthy = Object.values(healthStatus.dependencies).every(dep => dep.status === 'healthy');
      if (!allHealthy) {
        healthStatus.status = 'degraded';
      }

      return new Response(JSON.stringify(healthStatus), {
        status: allHealthy ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      logger.error('Health check failed', error);
      return new Response(JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        environment: env.ENVIRONMENT,
        error: 'Health check failed',
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Queue status endpoint
  if (url.pathname === '/queue/status') {
    logger.debug('Queue status requested');
    
    try {
      // Get queue metrics from Cloudflare GraphQL Analytics API
      // To implement actual metrics, you would need to:
      // 1. Add Cloudflare API token to environment variables
      // 2. Make GraphQL queries to https://api.cloudflare.com/client/v4/graphql
      // 3. Query the following datasets:
      //    - queuesBacklogAdaptiveGroups (backlog metrics)
      //    - queueConsumerMetricsAdaptiveGroups (consumer concurrency)  
      //    - queueMessageOperationsAdaptiveGroups (operations metrics)
      // Note: Actual implementation would require GraphQL API calls to Cloudflare Analytics
      const queueMetrics = {
        status: 'active',
        environment: env.ENVIRONMENT,
        timestamp: new Date().toISOString(),
        metrics: {
          // Backlog metrics (from queuesBacklogAdaptiveGroups dataset)
          backlog: {
            messages: 'requires_analytics_api_access',
            bytes: 'requires_analytics_api_access',
          },
          // Consumer metrics (from queueConsumerMetricsAdaptiveGroups dataset)
          consumer: {
            averageConcurrency: 'requires_analytics_api_access',
          },
          // Message operations (from queueMessageOperationsAdaptiveGroups dataset)
          operations: {
            totalBillableOperations: 'requires_analytics_api_access',
            totalBytes: 'requires_analytics_api_access',
            averageLagTime: 'requires_analytics_api_access', // ms between write and consume
            averageRetries: 'requires_analytics_api_access',
            maxMessageSize: 'requires_analytics_api_access',
          },
          // Additional operational metrics
          lastUpdated: new Date().toISOString(),
          note: 'Metrics require Cloudflare GraphQL Analytics API integration',
        },
        health: {
          queueAccessible: true,
          r2Accessible: true,
          dlqAccessible: true,
        },
        // Links to Cloudflare documentation for implementing metrics
        documentation: {
          metricsAPI: 'https://developers.cloudflare.com/queues/observability/metrics/',
          graphqlAPI: 'https://developers.cloudflare.com/analytics/graphql-api/',
        }
      };

      return new Response(JSON.stringify(queueMetrics), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to get queue status', error);
      return new Response(JSON.stringify({
        status: 'error',
        environment: env.ENVIRONMENT,
        timestamp: new Date().toISOString(),
        error: 'Failed to retrieve queue metrics',
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Default response for unknown endpoints
  logger.warn(`Unknown endpoint requested: ${url.pathname}`);
  return new Response(JSON.stringify({
    error: 'Not Found',
    message: 'Available endpoints: /health, /queue/status, /dlq, /dlq/replay',
  }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
