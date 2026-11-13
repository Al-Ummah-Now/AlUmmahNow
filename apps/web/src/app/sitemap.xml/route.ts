import { originFromHost } from '@/lib/embed/request-origin';
import { SITEMAP_HEADERS, sitemapIndexXml } from '@/lib/seo/sitemaps';
import { sitemapSummaryData, unavailable } from '@/lib/seo/sitemap-data';

export const dynamic = 'force-dynamic';

/** The videos site's sitemap index (lib/seo/sitemaps.ts). */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get('host');
  const summary = await sitemapSummaryData();
  if (!host || !summary) return unavailable();
  return new Response(sitemapIndexXml(originFromHost(host), summary), { headers: SITEMAP_HEADERS });
}
