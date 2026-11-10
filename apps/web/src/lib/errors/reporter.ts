/**
 * The web app's error reporter: every client-side error path ends here and
 * reaches the admin Errors page (docs/features/error-reporting.md).
 *
 *   reportError(error, { kind, shown, status, extra })  → reference ERR-XXXX-XXXX
 *   reportNeedsAction({ key, source, title, ... })      → an item an admin must act on
 *
 * Wired in automatically:
 * - window error / unhandledrejection / failed /_next/ chunk loads (ErrorReportingProvider)
 * - every logger.error() from '@/lib/logger-client' (forwardLoggedError)
 * - error boundaries (FriendlyError), version skew (lib/version-skew/report.ts)
 * - uploads (lib/upload/report-upload-error.ts), API helpers
 *
 * Events are scrubbed (no emails, tokens, query secrets), deduplicated,
 * batched and posted to the same-origin /api/errors route (sendBeacon when
 * the page is hidden), which queues them in admin-api.
 */
import { createErrorReporter, isVersionSkewError, type ClientReporter, type ErrorEventInput, type NeedsActionInput, type ReportOptions } from '@al-ummah/shared-types';

interface ReporterContext {
  userId?: string;
  workerVersion?: string;
  environment?: string;
}

const context: ReporterContext = {};
let reporter: ClientReporter | null = null;

/** Set from the root layout (server values): the signed-in usr_ id, the Worker version, the environment. */
export function setErrorContext(next: ReporterContext): void {
  context.userId = next.userId && /^usr_[A-Za-z0-9_-]+$/.test(next.userId) ? next.userId : undefined;
  if (next.workerVersion) context.workerVersion = next.workerVersion;
  if (next.environment) context.environment = next.environment;
}

function documentValue(read: (d: Document) => string | null | undefined): string | undefined {
  try {
    return typeof document !== 'undefined' ? read(document) || undefined : undefined;
  } catch {
    return undefined;
  }
}

export function getReporter(): ClientReporter | null {
  if (typeof window === 'undefined') return null;
  if (!reporter) {
    reporter = createErrorReporter({
      app: 'web',
      endpoint: '/api/errors',
      getContext: () => ({
        release: process.env.NEXT_PUBLIC_RELEASE || undefined,
        workerVersion: context.workerVersion,
        environment: context.environment,
        userId: context.userId,
        locale: documentValue((d) => d.documentElement.lang),
        theme: documentValue((d) => d.documentElement.getAttribute('data-theme')),
        route: window.location.pathname,
      }),
      // Version skew is reported by the skew recovery itself (lib/version-skew/report.ts)
      skip: (error) => isVersionSkewError(error),
    });
  }
  return reporter;
}

/** Reports an error; returns its reference (show it to the user when they saw an error). Never throws. */
export function reportError(error: unknown, opts: ReportOptions = {}): string {
  const r = getReporter();
  if (!r) return opts.ref ?? '';
  return r.report(error, opts);
}

/** Flags something only an admin can fix (no Retry from a browser). */
export function reportNeedsAction(input: Omit<NeedsActionInput, 'retry'> & { message?: string; extra?: ErrorEventInput['extra'] }): string {
  return getReporter()?.needsAction(input) ?? '';
}

export function flushErrorReports(useBeacon = false): void {
  getReporter()?.flush(useBeacon);
}

// ---------------------------------------------------------------------------
// logger.error() → reporter

let forwardingPaused = 0;

/** Runs fn without forwarding logger.error calls (for code that reports the same failure itself). */
export function withoutErrorForwarding<T>(fn: () => T): T {
  forwardingPaused += 1;
  try {
    return fn();
  } finally {
    forwardingPaused -= 1;
  }
}

type Extra = NonNullable<ErrorEventInput['extra']>;

function primitives(data: unknown): Extra {
  const out: Extra = {};
  if (!data || typeof data !== 'object' || data instanceof Error) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (Object.keys(out).length >= 10) break;
    if (k === 'error' || k === 'stack') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

function errorIn(data: unknown): unknown {
  if (data instanceof Error) return data;
  if (data && typeof data === 'object') {
    const e = (data as { error?: unknown }).error;
    if (e instanceof Error) return e;
    if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return e;
  }
  return null;
}

/**
 * Called by logger.error(message, data) in the browser. The Error inside
 * `data` (data itself, or data.error) is reported with the log message as
 * context; without one, the log message itself is reported. An Error that
 * was already reported directly is not sent again.
 */
export function forwardLoggedError(message: string, data: unknown): void {
  if (typeof window === 'undefined' || forwardingPaused > 0) return;
  const r = getReporter();
  if (!r) return;
  try {
    const found = errorIn(data);
    const extra: Extra = { logged: message.slice(0, 200), ...primitives(data) };
    const detail = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : typeof data === 'string' ? data : '';
    const error = found ?? Object.assign(new Error(detail ? `${message}: ${detail}` : message), { name: 'LoggedError' });
    // Let a direct reportError(sameError) in the same tick win
    queueMicrotask(() => {
      if (found && r.wasReported(found)) return;
      if (isVersionSkewError(found)) return;
      r.report(error, { kind: 'caught', extra });
    });
  } catch {
    // never break logging
  }
}
