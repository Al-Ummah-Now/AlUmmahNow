/**
 * Request trail for the Workers (server only: imports node:async_hooks, needs
 * nodejs_compat). Import it from `@al-ummah/shared-types/error-trail`, never
 * from browser code.
 *
 * `withErrorReporting` and `runWithErrorTrail` open a trail per request or
 * queue message. While it is open:
 *  - every global fetch is recorded as a breadcrumb (host + templated path +
 *    status), and the last one that failed (5xx or a network error) becomes the
 *    event's `upstream`
 *  - `breadcrumb()`, `noteIds()` and `noteUpstream()` add what the code knows
 * Any error reported in that async context (reportServerError /
 * reportNeedsAction) carries the trail as its `context`. Ids only; messages
 * are scrubbed by scrubContext before they leave.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeRoute } from './fingerprint';
import { CONTEXT_LIMITS, type ErrorBreadcrumb, type ErrorContext, type ErrorJob, type ErrorUpstream } from './context';
import type { RequestOrigin } from '../request-origin';
import { setErrorTrailHooks } from './worker';

interface Trail {
  videoId?: string;
  channelId?: string;
  job?: ErrorJob;
  upstream?: ErrorUpstream;
  breadcrumbs: ErrorBreadcrumb[];
  /** Where the request (or the job's starting request) came from */
  origin?: RequestOrigin;
}

const als = new AsyncLocalStorage<Trail>();

function push(t: Trail, kind: string, message: string): void {
  t.breadcrumbs.push({ at: new Date().toISOString(), kind, message: message.slice(0, CONTEXT_LIMITS.breadcrumbMessage) });
  if (t.breadcrumbs.length > CONTEXT_LIMITS.breadcrumbs) t.breadcrumbs.shift();
}

/** Runs fn with a fresh trail (one per request or queue message). */
export function runWithErrorTrail<T>(init: { job?: ErrorJob; videoId?: string; channelId?: string; origin?: RequestOrigin }, fn: () => T): T {
  installFetchTrail();
  return als.run({ ...init, breadcrumbs: [] }, fn);
}

/** Adds a step to the current trail (no-op outside one). Never pass names, emails or bodies. */
export function breadcrumb(kind: string, message: string): void {
  const t = als.getStore();
  if (t) push(t, kind, message);
}

/** The video / channel the current request or job is about. */
export function noteIds(ids: { videoId?: string | null; channelId?: string | null }): void {
  const t = als.getStore();
  if (!t) return;
  if (ids.videoId) t.videoId = ids.videoId;
  if (ids.channelId) t.channelId = ids.channelId;
}

/** A dependency call that failed (service binding, D1, R2, a provider SDK) when fetch did not see it. */
export function noteUpstream(service: string, status?: number, route?: string): void {
  const t = als.getStore();
  if (!t) return;
  t.upstream = { service, ...(status !== undefined ? { status } : {}), ...(route ? { route: normalizeRoute(route) } : {}) };
  push(t, 'upstream', `${service}${route ? ` ${normalizeRoute(route)}` : ''} → ${status ?? 'failed'}`);
}

/**
 * The origin of the request (or of the request that queued this job) being handled: for audit
 * rows and queued messages (request-origin.ts; no PII). Undefined outside a trail.
 */
export function currentRequestOrigin(): RequestOrigin | undefined {
  return als.getStore()?.origin;
}

/** Sets the current trail's origin (a job taking it over from its message). */
export function noteOrigin(origin: RequestOrigin | undefined): void {
  const t = als.getStore();
  if (t && origin) t.origin = origin;
}

/** Snapshot of the current trail as an event context (undefined outside a trail). */
export function currentErrorContext(): ErrorContext | undefined {
  const t = als.getStore();
  if (!t) return undefined;
  const c: ErrorContext = {};
  if (t.videoId) c.videoId = t.videoId;
  if (t.channelId) c.channelId = t.channelId;
  if (t.job) c.job = { ...t.job };
  if (t.origin) c.origin = { ...t.origin };
  if (t.upstream) c.upstream = { ...t.upstream };
  if (t.breadcrumbs.length) c.breadcrumbs = t.breadcrumbs.slice();
  return Object.keys(c).length ? c : undefined;
}

let installed = false;

/**
 * Wraps globalThis.fetch once so calls made inside a trail are recorded. The
 * wrapper calls whatever fetch is current at call time and changes nothing
 * about the request or response.
 */
export function installFetchTrail(): void {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const original = globalThis.fetch;
  const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const t = als.getStore();
    if (!t) return original.call(this, input, init);
    let host = '';
    let path = '';
    let method = init?.method ?? 'GET';
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      host = url.host;
      path = normalizeRoute(url.pathname);
      if (typeof input === 'object' && 'method' in input && !init?.method) method = input.method;
    } catch {
      host = 'unknown';
    }
    // The reporter's own post to the ingest is not part of the story
    if (path.endsWith('/internal/errors')) return original.call(this, input, init);
    return original.call(this, input, init).then(
      (res) => {
        push(t, 'fetch', `${method} ${host}${path} → ${res.status}`);
        if (res.status >= 500) t.upstream = { service: host, status: res.status, route: path };
        return res;
      },
      (error: unknown) => {
        push(t, 'fetch', `${method} ${host}${path} → network error`);
        t.upstream = { service: host, route: path };
        throw error;
      },
    );
  };
  globalThis.fetch = wrapped as typeof fetch;
}

/** Exposed for tests. */
export function resetFetchTrail(): void {
  installed = false;
}

setErrorTrailHooks({ current: currentErrorContext, run: runWithErrorTrail });
