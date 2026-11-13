import { logger } from '@/lib/logger-server';
import type { SitemapKind, SitemapSummary } from './sitemaps';

/** The api's base URL (server only). */
const apiBase = () => (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');

/** GET from the api's public sitemap endpoints; null when it cannot answer (the route then says 503). */
export async function fetchSitemapData<T>(path: string): Promise<T | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      logger.warn('[sitemap] api answered an error', { path, status: response.status });
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    logger.warn('[sitemap] api unreachable', { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export const sitemapSummaryData = () => fetchSitemapData<SitemapSummary>('/api/sitemap');
export const sitemapPageData = <T>(kind: SitemapKind, page: number) => fetchSitemapData<{ items: T[] }>(`/api/sitemap/${kind}?page=${page}`);

export const unavailable = () =>
  new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
