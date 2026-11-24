import { HELP_TOPIC_FEATURES, parseUserFeatures, type HelpTopicId } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { logger } from '@/lib/logger';

/** Whether a Help topic exists for everyone (api-videos GET /api/me/features, signed out). A topic with a feature doesn't while it can't be read. */
export async function helpTopicExists(topic: HelpTopicId): Promise<boolean> {
  const feature = HELP_TOPIC_FEATURES[topic];
  if (!feature) return true;
  try {
    const res = await fetch(buildApiUrl('/api/me/features'), { next: { revalidate: 30 } });
    if (res.ok) return parseUserFeatures(await res.json())[feature];
    logger.warn('[help] Features unavailable; topic hidden', { topic, status: res.status });
  } catch (error) {
    logger.warn('[help] Features unavailable; topic hidden', { topic, error: error instanceof Error ? error.message : String(error) });
  }
  return false;
}
