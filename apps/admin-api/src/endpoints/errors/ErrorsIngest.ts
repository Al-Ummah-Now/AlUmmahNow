/**
 * Error ingestion, asynchronous:
 *
 *   POST /internal/errors (X-API-Key)
 *     → key check, size limits, scrubbing, per-client rate limit
 *     → ERRORS_QUEUE (al-ummah-now-errors[-stage|-qa]); answers 202 at once
 *   queue consumer (this Worker, consumeErrorQueue)
 *     → D1 writes (lib/errors-store.ts), alerts (lib/errors-alerts.ts)
 *     → on failure: retried with backoff; after max_retries the batch goes to
 *       al-ummah-now-errors-dlq, also consumed here with long delays
 *
 * Callers: the web and admin-web /api/errors routes (browser reports; they
 * forward X-Client-IP / X-Client-User-Agent, and their retry specs are
 * dropped) and the Workers' reporters (@al-ummah/shared-types
 * reportServerError / reportNeedsAction / resolveNeedsAction).
 * Body: { events?: [...] (≤ 20), resolved?: [{ key }] }, at most 64 KB.
 * Without a queue binding (local dev) the batch is written inline.
 */
import type { Context } from 'hono';
import { ACTION_KEY, ERROR_LIMITS, USER_ID, buildServerEvent, parseUserAgent, scrubEvent, type ErrorApp, type ErrorEventInput, type StackFrame } from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { hashIp, safeEqual } from '../../lib/contact';
import { allowClientEvents, ingestErrorEvents, resolveActionItems, type IngestOutcome } from '../../lib/errors-store';
import { sendErrorAlerts } from '../../lib/errors-alerts';
import { symbolicateFrames } from '../../lib/sourcemaps';
import { logger } from '../../lib/logger';

const BROWSER_APPS: readonly ErrorApp[] = ['web', 'admin-web'];
/** A browser event may fold at most this many repeats into one report */
const BROWSER_MAX_COUNT = 50;

/**
 * A browser batch is untrusted: the page can send anything. Only what the
 * proxy (the app's /api/errors route, which holds the key) vouches for is
 * kept: the app it serves (X-Report-App), the signed-in account from its own
 * session (X-Client-User-Id), never the page's own claims. Counts are capped,
 * and "test" (no alert mail, pruned after a day) is honoured only outside
 * production, so a forged test event can never hide a real production error.
 */
export function constrainBrowserEvents(
  events: ErrorEventInput[],
  vouched: { app?: string | undefined; userId?: string | undefined; environment: string },
): ErrorEventInput[] {
  const app = BROWSER_APPS.includes(vouched.app as ErrorApp) ? (vouched.app as ErrorApp) : undefined;
  const userId = vouched.userId && USER_ID.test(vouched.userId) ? vouched.userId : undefined;
  const out: ErrorEventInput[] = [];
  for (const e of events) {
    const eventApp = app ?? (BROWSER_APPS.includes(e.app) ? e.app : null);
    if (!eventApp) continue; // a page cannot report as a Worker
    const { userId: _claimed, count, test, environment: _env, ...rest } = e;
    out.push({
      ...rest,
      app: eventApp,
      ...(userId ? { userId } : {}),
      ...(typeof count === 'number' ? { count: Math.max(1, Math.min(BROWSER_MAX_COUNT, Math.floor(count))) } : {}),
      ...(test && vouched.environment !== 'production' ? { test: true } : {}),
    });
  }
  return out;
}

/** What goes on the queue: everything already validated and scrubbed. */
export interface ErrorIngestMessage {
  v: 1;
  events: ErrorEventInput[];
  resolved: string[];
  clientKey?: string;
  userAgent?: string;
  /** False for browser batches: retry specs are not stored */
  trustedRetry: boolean;
  receivedAt: string;
}

async function resolveKey(binding: AdminBindings['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

/** Symbolicator for browser events when the release's source maps are in R2. */
export function symbolicatorFor(env: AdminBindings) {
  if (!env.SOURCEMAPS) return undefined;
  return (e: ErrorEventInput, frames: StackFrame[]) =>
    e.app === 'web' || e.app === 'admin-web' ? symbolicateFrames(env.SOURCEMAPS, e.app, e.release, frames) : Promise.resolve(null);
}

/** Writes one queued batch to D1 and sends the alerts it earned. Throws on D1 failure (the queue retries). */
export async function processIngestMessage(env: AdminBindings, msg: ErrorIngestMessage): Promise<IngestOutcome> {
  const now = new Date();
  const environment = env.ENVIRONMENT || 'development';
  const ua = parseUserAgent(msg.userAgent);
  const outcome = await ingestErrorEvents(env.REPORTS_DB, msg.events, {
    now,
    environment,
    clientKey: msg.clientKey,
    browser: ua.browser,
    os: ua.os,
    symbolicate: symbolicatorFor(env),
    trustedRetry: msg.trustedRetry,
  });
  if (msg.resolved.length) await resolveActionItems(env.REPORTS_DB, environment, msg.resolved, now);
  if (outcome.created.length || outcome.spiking.length) {
    await sendErrorAlerts(env.REPORTS_DB, env, outcome, now).catch((e) => logger.error('[Errors] Alerts failed', { error: String(e) }));
  }
  return outcome;
}

/** Queues the batch, or writes it inline when no queue is bound (local dev, tests). */
export async function enqueueIngest(env: AdminBindings, msg: ErrorIngestMessage): Promise<'queued' | 'written'> {
  if (env.ERRORS_QUEUE) {
    await env.ERRORS_QUEUE.send(msg, { contentType: 'json' });
    return 'queued';
  }
  await processIngestMessage(env, msg);
  return 'written';
}

/** Backoff of the ingest queue: 10 s, 20 s, 40 s … capped at 5 minutes; the DLQ waits 15 minutes. */
export function retryDelaySeconds(attempts: number, deadLetter: boolean): number {
  if (deadLetter) return 900;
  return Math.min(300, 10 * 2 ** Math.max(0, attempts - 1));
}

export interface QueueMessageLike {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

/** Consumer of al-ummah-now-errors[-env] and al-ummah-now-errors-dlq[-env]. */
export async function consumeErrorQueue(batch: { queue: string; messages: readonly QueueMessageLike[] }, env: AdminBindings): Promise<void> {
  const deadLetter = /errors-dlq/.test(batch.queue);
  for (const message of batch.messages) {
    const msg = message.body as ErrorIngestMessage;
    if (!msg || msg.v !== 1 || !Array.isArray(msg.events)) {
      logger.warn('[Errors] Dropped a malformed ingest message', { queue: batch.queue });
      message.ack();
      continue;
    }
    try {
      await processIngestMessage(env, { ...msg, resolved: msg.resolved ?? [] });
      message.ack();
    } catch (error) {
      logger.error('[Errors] Ingest attempt failed; retrying', {
        queue: batch.queue,
        attempts: message.attempts,
        events: msg.events.length,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts, deadLetter) });
    }
  }
}

export async function errorsIngest(c: Context<{ Bindings: AdminBindings }>): Promise<Response> {
  const env = c.env;
  const key = await resolveKey(env.INTERNAL_API_KEY);
  if (!key || !safeEqual(c.req.header('X-API-Key') ?? '', key)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const text = await c.req.text();
  if (text.length > ERROR_LIMITS.maxBodyBytes) return c.json({ success: false, error: 'too_large' }, 413);
  let body: { events?: unknown; resolved?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const rawEvents = Array.isArray(body?.events) ? body.events : [];
  const rawResolved = Array.isArray(body?.resolved) ? body.resolved : [];
  if (rawEvents.length > ERROR_LIMITS.maxEventsPerBatch || rawResolved.length > 50) return c.json({ success: false, error: 'too_many_events' }, 413);

  let events = rawEvents.map(scrubEvent).filter((e): e is ErrorEventInput => e !== null);
  const ip = c.req.header('X-Client-IP');
  const fromBrowser = !!ip || c.req.header('X-Report-Source') === 'browser';
  // Only Workers may resolve items; browsers can neither resolve nor attach retries
  const resolved = fromBrowser
    ? []
    : rawResolved.map((r) => (r as { key?: unknown })?.key).filter((k): k is string => typeof k === 'string' && ACTION_KEY.test(k));
  if (events.length === 0 && resolved.length === 0) return c.json({ success: false, error: 'no valid events' }, 400);

  if (fromBrowser) {
    events = constrainBrowserEvents(events, {
      app: c.req.header('X-Report-App'),
      userId: c.req.header('X-Client-User-Id'),
      environment: env.ENVIRONMENT || 'development',
    });
    if (events.length === 0) return c.json({ success: false, error: 'no valid events' }, 400);
  }
  const userAgent = c.req.header('X-Client-User-Agent') || undefined;
  // Rate limit per IP (a changing user agent must not reset it); anonymous visitors are counted by a
  // keyed hash of IP + browser. Neither the IP nor the user agent is stored.
  const rateKey = ip ? (await hashIp(ip, key)).slice(0, 24) : undefined;
  const clientKey = ip ? (await hashIp(`${ip}|${userAgent ?? ''}`, key)).slice(0, 24) : undefined;

  let rateLimited = 0;
  try {
    if (rateKey && events.length) {
      const allowed = await allowClientEvents(env.REPORTS_DB, rateKey, events.length, new Date());
      rateLimited = events.length - allowed;
      events = events.slice(0, allowed);
      if (events.length === 0 && resolved.length === 0) return c.json({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': '60' });
    }
    const how = await enqueueIngest(env, {
      v: 1,
      events,
      resolved,
      clientKey,
      userAgent: userAgent?.slice(0, 512),
      trustedRetry: !fromBrowser,
      receivedAt: new Date().toISOString(),
    });
    return c.json({ success: true, result: { accepted: events.length, resolved: resolved.length, rateLimited, [how]: true } }, 202);
  } catch (error) {
    logger.error('[Errors] Could not queue error events', { error: error instanceof Error ? error.message : String(error), events: events.length });
    return c.json({ success: false, error: 'ingest_failed' }, 503, { 'Retry-After': '30' });
  }
}

/**
 * admin-api's own uncaught exceptions and 5xx answers go through the same
 * queue (no HTTP round trip). Returns the reference.
 */
export function reportAdminApiError(
  c: { env: AdminBindings; req: { path: string; method: string; header(name: string): string | undefined }; executionCtx: { waitUntil(p: Promise<unknown>): void } },
  error: unknown,
  status: number,
): string {
  const event = buildServerEvent(
    'admin-api',
    error,
    { kind: error ? 'unhandled' : 'http', route: c.req.path, method: c.req.method, status, requestId: c.req.header('cf-ray') || c.req.header('x-request-id') },
    { ENVIRONMENT: c.env.ENVIRONMENT, CF_VERSION_METADATA: (c.env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA },
  );
  if (!event || !c.env.REPORTS_DB) return event?.ref ?? '';
  const work = ingestAndAlert(c.env, [event]).catch((e) => logger.error('[Errors] Could not record admin-api error', { error: String(e) }));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // outside a request (tests)
  }
  return event.ref;
}

/** Queues events admin-api itself produced (its own errors, contact delivery failures). */
export async function ingestAndAlert(env: AdminBindings, events: ErrorEventInput[]): Promise<void> {
  await enqueueIngest(env, { v: 1, events, resolved: [], trustedRetry: true, receivedAt: new Date().toISOString() });
}
