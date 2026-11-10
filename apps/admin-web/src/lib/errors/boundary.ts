/**
 * What an error boundary does with an error (pure; the boundaries and tests
 * share it). The user only ever sees a friendly screen and a reference:
 * - a server-rendering error carries Next's digest: its reference is derived
 *   from it (errorRefFromDigest), the same one instrumentation.ts reported
 *   on the server, so the browser does not report it again;
 * - version skew (a deploy while the page was open) is handed to the skew
 *   recovery (reload) and reported with kind 'skew'; the boundary renders
 *   nothing of its own;
 * - anything else is reported as shown to the user, under the reference
 *   the screen displays.
 */
import { errorRefFromDigest, friendlyErrorKind, newErrorRef, type FriendlyErrorKind, type ReportOptions } from '@al-ummah/shared-types';
import { isVersionSkewError } from '@/lib/version-skew';

export interface BoundaryOutcome {
  ref: string;
  skew: boolean;
  kind: FriendlyErrorKind;
  /** How to report it from the browser; null when the server already did. */
  report: ReportOptions | null;
}

export function boundaryOutcome(error: unknown, opts: { online?: boolean } = {}): BoundaryOutcome {
  const digest = error && typeof error === 'object' ? (error as { digest?: unknown }).digest : undefined;
  const ref = typeof digest === 'string' && digest ? errorRefFromDigest(digest) : newErrorRef();
  if (isVersionSkewError(error)) return { ref, skew: true, kind: 'update', report: { kind: 'skew', ref } };
  const kind = friendlyErrorKind(error, { online: opts.online, digest: typeof digest === 'string' ? digest : undefined });
  return { ref, skew: false, kind, report: typeof digest === 'string' && digest ? null : { kind: 'boundary', shown: true, ref } };
}

export interface BoundaryDeps {
  recover: (error: unknown, source: string) => boolean;
  report: (error: unknown, opts: ReportOptions) => string;
}

/**
 * Runs after the boundary mounted: first the skew recovery, then the report.
 * Returns true when the skew recovery took over (the boundary shows nothing).
 */
export function handleBoundaryError(error: unknown, outcome: BoundaryOutcome, deps: BoundaryDeps): boolean {
  const recovering = deps.recover(error, 'boundary');
  if (recovering) {
    deps.report(error, { kind: 'skew', ref: outcome.ref });
    return true;
  }
  if (outcome.report) deps.report(error, outcome.report);
  return false;
}
