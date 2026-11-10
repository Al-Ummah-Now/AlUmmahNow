/**
 * admin-web's browser error reporter (docs/features/error-reporting.md).
 * Events go to the same-origin /api/errors route, which forwards them to
 * admin-api with the internal key. Installed by ErrorReportingProvider.
 *
 *   const ref = reportError(error, { kind: 'fetch', status: res.status });
 *   reportNeedsAction({ key: 'job:42', source: 'admin-job', title: 'Re-index failed' });
 */
import { createErrorReporter, type ClientErrorContext, type ClientReporter, type ReportOptions } from '@al-ummah/shared-types';

/** Set by the providers: locale and theme from the root layout, the admin's usr_ id from the protected layout. */
const context: ClientErrorContext = { release: process.env.NEXT_PUBLIC_RELEASE };

export function setErrorContext(patch: Partial<ClientErrorContext>): void {
  Object.assign(context, patch);
}

export function getErrorContext(): ClientErrorContext {
  const route = typeof window !== 'undefined' ? window.location.pathname : undefined;
  return { ...context, route };
}

export const errorReporter: ClientReporter = createErrorReporter({
  app: 'admin-web',
  endpoint: '/api/errors',
  getContext: getErrorContext,
});

/** Reports an error and returns its reference (ERR-XXXX-XXXX). Never throws. */
export function reportError(error: unknown, opts?: ReportOptions): string {
  return errorReporter.report(error, opts);
}

/** Flags something only an admin can fix on the Errors page (no Retry from a browser). */
export function reportNeedsAction(input: Parameters<ClientReporter['needsAction']>[0]): string {
  return errorReporter.needsAction(input);
}
