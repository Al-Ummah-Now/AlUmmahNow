/**
 * Server-side reporter for the Workers (api-videos, processor, scheduler,
 * websocket, and the web/admin-web SSR). Uncaught exceptions and 5xx
 * responses are posted to admin-api POST /internal/errors with the internal
 * API key, after the response (waitUntil). It never throws and never delays
 * the request.
 *
 * Per isolate, the same error is sent at most once every 10 seconds; repeats
 * in between are counted and folded into the next report, so a crash loop
 * cannot flood admin-api.
 */
import { scrubEvent } from './scrub';
import { fingerprint } from './fingerprint';
import { newErrorRef } from './reference';
import { idsFromRoute, normalizeRouteForOrigin } from './context';
import { originOf, type OriginOptions } from '../request-origin';
import type { ErrorContext } from './context';
import type { ErrorApp, ErrorEventInput, ErrorKind, ErrorReportBatch, NeedsActionInput } from './types';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface ErrorReporterEnv {
  /** admin-api's ingest URL, e.g. https://admin.api.alummahnow.net/internal/errors */
  ERRORS_INGEST_URL?: string;
  INTERNAL_API_KEY?: SecretBinding;
  ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string };
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ServerErrorDetails {
  kind?: ErrorKind;
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  userId?: string;
  ref?: string;
  release?: string;
  test?: boolean;
  extra?: ErrorEventInput['extra'];
  /** Ids, upstream, job; merged over the open request trail. */
  context?: ErrorContext;
}

/**
 * The request trail (./trail.ts, server only) registers itself here when an app
 * imports `@al-ummah/shared-types/error-trail`; without it events carry only
 * the context the caller passes.
 */
let trailHooks: { current(): ErrorContext | undefined; run<T>(init: { videoId?: string; channelId?: string }, fn: () => T): T } | null = null;

export function setErrorTrailHooks(hooks: typeof trailHooks): void {
  trailHooks = hooks;
}

/** The caller's context over the open trail's (caller wins per field; breadcrumbs from the trail). */
export function mergeContext(given: ErrorContext | undefined): ErrorContext | undefined {
  let fromTrail: ErrorContext | undefined;
  try {
    fromTrail = trailHooks?.current();
  } catch {
    fromTrail = undefined;
  }
  if (!fromTrail) return given;
  if (!given) return fromTrail;
  return { ...fromTrail, ...given, breadcrumbs: given.breadcrumbs ?? fromTrail.breadcrumbs };
}

async function resolveKey(binding: SecretBinding): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

const DEDUPE_MS = 10_000;
const recent = new Map<string, { at: number; suppressed: number }>();

/** Exposed for tests. */
export function resetServerReporterState(): void {
  recent.clear();
}

/** Builds the event for an error (or a 5xx without one). Pure; exported for tests. */
export function buildServerEvent(app: ErrorApp, error: unknown, d: ServerErrorDetails, env: ErrorReporterEnv): ErrorEventInput | null {
  const err = error instanceof Error ? error : null;
  const message = err ? err.message || err.name : error != null ? String(error) : `HTTP ${d.status ?? 500}`;
  return scrubEvent({
    app,
    kind: d.kind ?? (error != null ? 'unhandled' : 'http'),
    ref: d.ref ?? newErrorRef(),
    name: err?.name,
    message: message || 'Unknown error',
    stack: err?.stack,
    route: d.route,
    method: d.method,
    status: d.status,
    release: d.release,
    workerVersion: env.CF_VERSION_METADATA?.id,
    environment: env.ENVIRONMENT,
    userId: d.userId,
    requestId: d.requestId,
    occurredAt: new Date().toISOString(),
    test: d.test,
    extra: d.extra,
    context: mergeContext(d.context),
  });
}

/**
 * Sends the event in the background. Returns the reference (also when the
 * event is folded into a later one or reporting is not configured).
 */
export function reportServerError(
  app: ErrorApp,
  env: ErrorReporterEnv,
  ctx: ExecutionContextLike | undefined,
  error: unknown,
  details: ServerErrorDetails = {},
  fetchImpl: typeof fetch = fetch,
): string {
  // Reporting must never break the caller (a broken env, an odd error object)
  try {
    return reportServerErrorOrThrow(app, env ?? {}, ctx, error, details, fetchImpl);
  } catch {
    return details.ref ?? newErrorRef();
  }
}

function reportServerErrorOrThrow(
  app: ErrorApp,
  env: ErrorReporterEnv,
  ctx: ExecutionContextLike | undefined,
  error: unknown,
  details: ServerErrorDetails,
  fetchImpl: typeof fetch,
): string {
  const event = buildServerEvent(app, error, details, env);
  if (!event) return details.ref ?? newErrorRef();
  const url = env.ERRORS_INGEST_URL;
  if (!url) return event.ref;

  const fp = fingerprint(event);
  const now = Date.now();
  const seen = recent.get(fp);
  if (seen && now - seen.at < DEDUPE_MS && !event.test) {
    seen.suppressed += 1;
    return event.ref;
  }
  event.count = 1 + (seen?.suppressed ?? 0);
  recent.set(fp, { at: now, suppressed: 0 });
  if (recent.size > 500) recent.delete(recent.keys().next().value as string);

  postReport(env, ctx, { events: [event] }, fetchImpl);
  return event.ref;
}

/** Posts a batch to admin-api in the background (waitUntil). Never throws. */
export function postReport(env: ErrorReporterEnv, ctx: ExecutionContextLike | undefined, batch: ErrorReportBatch, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = env?.ERRORS_INGEST_URL;
  const work = (async () => {
    if (!url) return;
    const key = await resolveKey(env.INTERNAL_API_KEY);
    if (!key) return;
    await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify(batch),
    }).catch(() => undefined);
  })().catch(() => undefined);
  try {
    if (ctx) ctx.waitUntil(work);
  } catch {
    // waitUntil unavailable (tests, outside a request): the promise still runs
  }
  return work;
}

export interface NeedsActionDetails extends NeedsActionInput {
  /** Why it failed (scrubbed); shown on the item. Defaults to the title. */
  message?: string;
  error?: unknown;
  route?: string;
  userId?: string;
  requestId?: string;
  release?: string;
  test?: boolean;
  extra?: ErrorEventInput['extra'];
  context?: ErrorContext;
}

/**
 * Flags an item for an admin on the Errors page ("needs action"): a failed
 * job, a dead-lettered message, an email that was not sent, an AI step or
 * an admin job that failed. Reporting the same key again updates the one
 * item (and reopens it if it was resolved). Returns the reference.
 *
 *   reportNeedsAction('processor', env, ctx, {
 *     key: `dlq:${id}`, source: 'dlq', title: 'Queue message dead-lettered',
 *     message: failureReason, itemType: 'dead-letter', itemId: id,
 *     retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id } },
 *     retryLabel: 'Replay message',
 *   });
 */
export function reportNeedsAction(app: ErrorApp, env: ErrorReporterEnv, ctx: ExecutionContextLike | undefined, d: NeedsActionDetails, fetchImpl: typeof fetch = fetch): string {
  try {
    return reportNeedsActionOrThrow(app, env ?? {}, ctx, d, fetchImpl);
  } catch {
    return '';
  }
}

function reportNeedsActionOrThrow(app: ErrorApp, env: ErrorReporterEnv, ctx: ExecutionContextLike | undefined, d: NeedsActionDetails, fetchImpl: typeof fetch): string {
  const err = d.error instanceof Error ? d.error : null;
  const { message, error, route, userId, requestId, release, test, extra, context, ...action } = d;
  const event = scrubEvent({
    app,
    kind: 'action',
    ref: newErrorRef(),
    name: err?.name,
    message: message || err?.message || (error != null && !err ? String(error) : '') || d.title,
    stack: err?.stack,
    route,
    userId,
    requestId,
    release,
    workerVersion: env.CF_VERSION_METADATA?.id,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    test,
    extra,
    action,
    context: mergeContext(context),
  });
  if (!event) return '';
  postReport(env, ctx, { events: [event] }, fetchImpl);
  return event.ref;
}

/** Marks needs-action items resolved because the feature fixed them itself (a later attempt succeeded). */
export function resolveNeedsAction(env: ErrorReporterEnv, ctx: ExecutionContextLike | undefined, keys: string | string[], fetchImpl: typeof fetch = fetch): void {
  const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === 'string' && k).slice(0, 50);
  if (list.length) postReport(env, ctx, { resolved: list.map((key) => ({ key })) }, fetchImpl);
}

/** Which classifier an app's requests use (request-origin.ts). */
export function originAppOf(app: ErrorApp): OriginOptions['app'] {
  return app === 'web' ? 'web' : app === 'admin-web' || app === 'admin-api' ? 'admin' : app === 'auth' ? 'auth' : 'api';
}

/** The request's origin for an error report; never throws (undefined when it can't be read). */
export function requestOriginFor(app: ErrorApp, req: Request, env: ErrorReporterEnv | undefined) {
  try {
    const path = new URL(req.url).pathname;
    return originOf(req, {
      app: originAppOf(app),
      release: env?.CF_VERSION_METADATA?.tag || undefined,
      entry: normalizeRouteForOrigin(path),
      embed: app === 'web' && path.startsWith('/embed'),
    });
  } catch {
    return undefined;
  }
}

/** Request id for a Worker request: Cloudflare's ray id, else the caller's X-Request-Id. */
export function requestIdOf(req: Request): string | undefined {
  return req.headers.get('cf-ray') || req.headers.get('x-request-id') || undefined;
}

/**
 * Wraps a module Worker's fetch handler: an uncaught exception is reported
 * and answered with a generic 500 that carries only the reference; a 5xx the
 * handler returns is reported too. The reference goes back in X-Error-Ref so
 * the web apps can show it.
 */
export function withErrorReporting<E extends ErrorReporterEnv, C extends ExecutionContextLike>(
  app: ErrorApp,
  handler: (req: Request, env: E, ctx: C) => Response | Promise<Response>,
): (req: Request, env: E, ctx: C) => Promise<Response> {
  const inner = async (req: Request, env: E, ctx: C): Promise<Response> => {
    const url = new URL(req.url);
    const base = { route: url.pathname, method: req.method, requestId: requestIdOf(req), context: { origin: requestOriginFor(app, req, env) } };
    try {
      const res = await handler(req, env, ctx);
      if (res.status >= 500 && !res.headers.has('X-Error-Ref')) {
        const ref = reportServerError(app, env, ctx, null, { ...base, kind: 'http', status: res.status });
        try {
          const copy = new Response(res.body, res);
          copy.headers.set('X-Error-Ref', ref);
          return copy;
        } catch {
          return res;
        }
      }
      return res;
    } catch (error) {
      const ref = reportServerError(app, env, ctx, error, { ...base, status: 500 });
      return new Response(JSON.stringify({ success: false, error: 'Internal server error', reference: ref }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'X-Error-Ref': ref },
      });
    }
  };
  // One request trail per request when the app loaded it (ids from the path to start with)
  return (req, env, ctx) => {
    if (!trailHooks) return inner(req, env, ctx);
    let ids = {};
    try {
      ids = idsFromRoute(new URL(req.url).pathname);
    } catch {
      ids = {};
    }
    return trailHooks.run(ids, () => inner(req, env, ctx));
  };
}
