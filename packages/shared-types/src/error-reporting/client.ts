/**
 * Browser reporter for the web and admin-web apps. Events are scrubbed,
 * deduplicated and batched, then posted to the app's own /api/errors route
 * (same origin, so sendBeacon works and no CORS/CSP host is needed), which
 * forwards them to admin-api.
 *
 * - Errors the user saw (shown: true) are always sent: their reference must
 *   be findable by support.
 * - Background errors are deduplicated per page: the first 3 of a kind are
 *   sent in full, later ones only add to a count sent with the next batch.
 * - Noisy kinds (network failures, rejections) are sampled, and a page sends
 *   at most 30 background events.
 */
import { classifyKind } from './client-kind';
import { isIgnorableError, messageOf } from './classify';
import { fingerprint } from './fingerprint';
import { newErrorRef } from './reference';
import { scrubEvent } from './scrub';
import type { ErrorApp, ErrorEventInput, ErrorKind, NeedsActionInput } from './types';

export interface ClientErrorContext {
  release?: string;
  workerVersion?: string;
  environment?: string;
  locale?: string;
  theme?: string;
  userId?: string;
  route?: string;
}

export interface ReportOptions {
  kind?: ErrorKind;
  shown?: boolean;
  /** Use this reference (e.g. derived from a server digest) instead of a new one. */
  ref?: string;
  status?: number;
  requestId?: string;
  test?: boolean;
  extra?: ErrorEventInput['extra'];
}

export interface ClientReporterOptions {
  app: ErrorApp;
  endpoint?: string;
  getContext: () => ClientErrorContext;
  /** Probability a background event of this kind is sent (default: 0.25 for network failures, 1 otherwise). */
  sampleRate?: (kind: ErrorKind, error: unknown) => number;
  flushDelayMs?: number;
  /** Injected in tests. */
  transport?: (body: string, useBeacon: boolean) => void;
  random?: () => number;
}

export interface ClientReporter {
  /** Reports an error and returns its reference. */
  report(error: unknown, opts?: ReportOptions): string;
  /**
   * Flags an item for an admin (Errors page "needs action"). From a browser
   * there is no Retry action: admin-api drops retry specs from browsers.
   */
  needsAction(input: Omit<NeedsActionInput, 'retry'> & { message?: string; extra?: ErrorEventInput['extra'] }): string;
  flush(useBeacon?: boolean): void;
  /** window error / unhandledrejection listeners and flush on page hide. Returns an uninstall function. */
  install(onError?: (error: unknown, kind: ErrorKind) => void): () => void;
}

const MAX_BACKGROUND = 30;
const FULL_REPEATS = 3;
type G = typeof globalThis & {
  navigator?: { sendBeacon?(url: string, data: unknown): boolean; userAgent?: string };
  location?: { pathname: string };
  document?: { visibilityState?: string; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
  addEventListener?: (t: string, f: (e: unknown) => void) => void;
  removeEventListener?: (t: string, f: (e: unknown) => void) => void;
  Blob?: new (parts: string[], opts: { type: string }) => unknown;
  fetch?: typeof fetch;
  setTimeout: typeof setTimeout;
};

function defaultTransport(endpoint: string) {
  return (body: string, useBeacon: boolean) => {
    const g = globalThis as G;
    if (useBeacon && g.navigator?.sendBeacon && g.Blob) {
      try {
        if (g.navigator.sendBeacon(endpoint, new g.Blob([body], { type: 'application/json' }))) return;
      } catch {
        // fall through to fetch
      }
    }
    g.fetch?.(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }).catch(() => undefined);
  };
}

export function createErrorReporter(options: ClientReporterOptions): ClientReporter {
  const endpoint = options.endpoint ?? '/api/errors';
  const transport = options.transport ?? defaultTransport(endpoint);
  const random = options.random ?? Math.random;
  const sampleRate = options.sampleRate ?? ((kind: ErrorKind, error: unknown) => (kind === 'fetch' && /fetch|network|load failed/i.test(messageOf(error)) ? 0.25 : kind === 'rejection' ? 0.5 : 1));
  const queue: ErrorEventInput[] = [];
  const seen = new Map<string, { sent: number; folded: number; last: ErrorEventInput }>();
  let background = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) return;
    timer = (globalThis as G).setTimeout(() => {
      timer = null;
      flush(false);
    }, options.flushDelayMs ?? 2000);
    // Never keep a non-browser runtime (tests, SSR) alive just to flush
    (timer as { unref?: () => void }).unref?.();
  };

  function flush(useBeacon = false) {
    // Repeats folded since the last batch go out as one event with their count
    for (const entry of seen.values()) {
      if (entry.folded > 0) {
        queue.push({ ...entry.last, ref: newErrorRef(), count: entry.folded, shown: false, occurredAt: new Date().toISOString() });
        entry.folded = 0;
      }
    }
    while (queue.length) {
      const batch = queue.splice(0, 20);
      try {
        transport(JSON.stringify({ events: batch }), useBeacon);
      } catch {
        // reporting must never break the page
      }
    }
  }

  function report(error: unknown, opts: ReportOptions = {}): string {
    const ref = opts.ref ?? newErrorRef();
    try {
      const err = error instanceof Error ? error : null;
      const stack = err?.stack;
      if (!opts.shown && isIgnorableError(error, stack)) return ref;
      const kind = opts.kind ?? classifyKind(error, 'unhandled');
      const ctx = options.getContext();
      const g = globalThis as G;
      const event = scrubEvent({
        app: options.app,
        kind,
        ref,
        name: err?.name || (error && typeof error === 'object' ? (error as { name?: string }).name : undefined),
        message: messageOf(error) || 'Unknown error',
        stack,
        route: ctx.route ?? g.location?.pathname,
        status: opts.status,
        release: ctx.release,
        workerVersion: ctx.workerVersion,
        environment: ctx.environment,
        locale: ctx.locale,
        theme: ctx.theme,
        userId: ctx.userId,
        requestId: opts.requestId,
        occurredAt: new Date().toISOString(),
        shown: opts.shown === true,
        test: opts.test,
        extra: opts.extra,
      });
      if (!event) return ref;

      if (!event.shown) {
        const fp = fingerprint(event);
        const entry = seen.get(fp);
        if (entry && entry.sent >= FULL_REPEATS) {
          entry.folded += 1;
          entry.last = event;
          schedule();
          return ref;
        }
        if (background >= MAX_BACKGROUND) return ref;
        if (random() >= sampleRate(kind, error)) return ref;
        background += 1;
        if (entry) entry.sent += 1;
        else seen.set(fp, { sent: 1, folded: 0, last: event });
      }
      queue.push(event);
      if (event.shown || queue.length >= 10) flush(false);
      else schedule();
    } catch {
      // never throw from the reporter
    }
    return ref;
  }

  function install(onError?: (error: unknown, kind: ErrorKind) => void): () => void {
    const g = globalThis as G;
    if (!g.addEventListener) return () => undefined;
    const onWindowError = (e: unknown) => {
      const ev = e as { error?: unknown; message?: string; filename?: string; target?: { tagName?: string; src?: string; href?: string } };
      // A failed <script>/<link> load fires "error" on the element (captured), with no Error object
      const target = ev.target;
      if (target && target.tagName && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const src = target.src || target.href || '';
        if (!/\/_next\//.test(src)) return;
        const error = Object.assign(new Error(`Loading chunk failed: ${src.replace(/^.*\/_next\//, '/_next/')}`), { name: 'ChunkLoadError' });
        report(error, { kind: 'chunk' });
        onError?.(error, 'chunk');
        return;
      }
      const error = ev.error ?? ev.message;
      const kind = classifyKind(error, 'unhandled');
      report(error, { kind });
      onError?.(error, kind);
    };
    const onRejection = (e: unknown) => {
      const reason = (e as { reason?: unknown }).reason;
      const kind = classifyKind(reason, 'rejection');
      report(reason, { kind });
      onError?.(reason, kind);
    };
    const onHide = () => {
      if (!g.document || g.document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => flush(true);
    g.addEventListener('error', onWindowError);
    // Resource load errors do not bubble: listen in the capture phase as well
    (g.addEventListener as unknown as (t: string, f: (e: unknown) => void, c: boolean) => void)('error', onWindowError, true);
    g.addEventListener('unhandledrejection', onRejection);
    g.addEventListener('pagehide', onPageHide);
    g.document?.addEventListener?.('visibilitychange', onHide);
    return () => {
      g.removeEventListener?.('error', onWindowError);
      (g.removeEventListener as unknown as (t: string, f: (e: unknown) => void, c: boolean) => void)?.('error', onWindowError, true);
      g.removeEventListener?.('unhandledrejection', onRejection);
      g.removeEventListener?.('pagehide', onPageHide);
      g.document?.removeEventListener?.('visibilitychange', onHide);
    };
  }

  function needsAction(input: Omit<NeedsActionInput, 'retry'> & { message?: string; extra?: ErrorEventInput['extra'] }): string {
    const ref = newErrorRef();
    try {
      const ctx = options.getContext();
      const { message, extra, ...action } = input;
      const event = scrubEvent({
        app: options.app,
        kind: 'action',
        ref,
        message: message || input.title,
        route: ctx.route ?? (globalThis as G).location?.pathname,
        release: ctx.release,
        workerVersion: ctx.workerVersion,
        environment: ctx.environment,
        locale: ctx.locale,
        theme: ctx.theme,
        userId: ctx.userId,
        occurredAt: new Date().toISOString(),
        extra,
        action,
      });
      if (event) {
        queue.push(event);
        schedule();
      }
    } catch {
      // never throw from the reporter
    }
    return ref;
  }

  return { report, needsAction, flush, install };
}
