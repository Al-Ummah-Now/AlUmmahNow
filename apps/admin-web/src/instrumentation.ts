/**
 * Server-rendering errors → the Errors page. The reference is derived from
 * Next's digest, which is all the browser's error boundary receives, so the
 * reference the user sees finds this server event (lib/errors/boundary.ts).
 */
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const [{ getCloudflareContext }, { errorRefFromDigest, reportServerError }] = await Promise.all([
      import('@opennextjs/cloudflare'),
      import('@al-ummah/shared-types'),
    ]);
    const { env, ctx } = await getCloudflareContext({ async: true });
    const digest = err && typeof err === 'object' ? (err as { digest?: unknown }).digest : undefined;
    const header = (name: string) => {
      const value = request.headers?.[name];
      return Array.isArray(value) ? value[0] : value;
    };
    reportServerError('admin-web', env as never, ctx, err, {
      ref: typeof digest === 'string' && digest ? errorRefFromDigest(digest) : undefined,
      route: context.routePath || request.path,
      method: request.method,
      status: 500,
      release: process.env.NEXT_PUBLIC_RELEASE,
      requestId: header('cf-ray') || header('x-request-id') || undefined,
      extra: { routerKind: context.routerKind, routeType: context.routeType, renderSource: (context as { renderSource?: string }).renderSource ?? '' },
    });
  } catch {
    // Not on Workers (next dev, build) or reporting unavailable: never make an error worse
  }
};
