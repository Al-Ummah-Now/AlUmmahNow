import { originFromHost } from '@/lib/embed/request-origin';
import { isProductionDeployment, NOINDEX, robotsTxt } from '@/lib/seo/robots';

/** Read per request: NEXTJS_ENV is a Worker var, and the host is the fallback (lib/seo/robots.ts). */
export const dynamic = 'force-dynamic';

/**
 * robots.txt for the videos host. Cloudflare's managed robots.txt prepends its content-signal
 * block to this on production.
 */
export function GET(request: Request): Response {
  const host = request.headers.get('host');
  const production = isProductionDeployment(process.env.NEXTJS_ENV, host);
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  };
  if (!production) headers['X-Robots-Tag'] = NOINDEX;
  return new Response(robotsTxt(production, host ? originFromHost(host) : undefined), { headers });
}
