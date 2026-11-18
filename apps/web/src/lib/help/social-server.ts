import { isSocialNetwork, type SocialNetwork } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { logger } from '@/lib/logger';

/** The networks a creator can connect (api-videos GET /api/social/networks); none when it can't be read. */
export async function getHelpNetworks(): Promise<SocialNetwork[]> {
  try {
    const res = await fetch(buildApiUrl('/api/social/networks'), { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { networks?: unknown[] };
    return (body.networks ?? []).filter(isSocialNetwork);
  } catch (error) {
    logger.warn('[help] Social networks unavailable; Help names none', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
