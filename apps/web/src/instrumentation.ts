/**
 * Server-side errors of the web app (page renders, route handlers, Server
 * Actions, middleware) → admin Errors page. The reference is derived from
 * Next's error digest, the same way the browser's error boundary derives it
 * (FriendlyError), so the reference a user quotes finds this server event.
 */
import type { Instrumentation } from 'next';

export function register(): void {
  // Nothing to set up: reporting is per request (onRequestError)
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const { reportServerError, errorRefFromDigest } = await import('@al-ummah/shared-types');
    let env: Record<string, unknown> = {};
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const cf = await getCloudflareContext({ async: true });
      env = cf.env as unknown as Record<string, unknown>;
      ctx = cf.ctx as unknown as { waitUntil(p: Promise<unknown>): void };
    } catch {
      return; // next dev / build: no Worker env, nothing to report to
    }
    const digest = (error as { digest?: unknown } | null)?.digest;
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const header = (name: string) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    reportServerError(
      'web',
      {
        ERRORS_INGEST_URL: env.ERRORS_INGEST_URL as string | undefined,
        INTERNAL_API_KEY: env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined,
        ENVIRONMENT: (env.NEXTJS_ENV as string | undefined) ?? process.env.NEXTJS_ENV,
        CF_VERSION_METADATA: env.CF_VERSION_METADATA as { id?: string } | undefined,
      },
      ctx,
      error,
      {
        ...(typeof digest === 'string' && digest ? { ref: errorRefFromDigest(digest) } : {}),
        route: context.routePath || request.path,
        method: request.method,
        status: 500,
        requestId: header('cf-ray') || header('x-request-id'),
        release: process.env.NEXT_PUBLIC_RELEASE,
        // The release E2E trigger page (app/[locale]/dev/error-test): a test group
        ...((context.routePath || request.path).includes('/dev/error-test') ? { test: true } : {}),
        extra: { routeType: context.routeType, routerKind: context.routerKind, renderSource: (context as { renderSource?: string }).renderSource ?? null },
      },
    );
  } catch {
    // reporting must never fail the request
  }
};
