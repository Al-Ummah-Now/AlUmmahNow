/**
 * Server-side: the scholar who linked a channel (AlUmmahNowCMS public API
 * `/scholars/by-channel/:id`), so the channel page can link to their page on www.
 * Never throws: no CMS, a slow one or no scholar all mean "no link".
 */
import { logger } from '@/lib/logger';
import { deriveCmsUrl } from './sites';

const TIMEOUT_MS = 1500;

export async function scholarSlugForChannel(channelId: string): Promise<string | null> {
  const cms = deriveCmsUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.CMS_URL);
  if (!cms || !/^[A-Za-z0-9_-]{1,128}$/.test(channelId)) return null;
  try {
    const res = await fetch(`${cms}/api/public/v1/scholars/by-channel/${encodeURIComponent(channelId)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { slug?: unknown };
    return typeof body.slug === 'string' && /^[a-z0-9-]{1,60}$/.test(body.slug) ? body.slug : null;
  } catch (error) {
    logger.debug('[Scholars] channel lookup failed', { channelId, error });
    return null;
  }
}
