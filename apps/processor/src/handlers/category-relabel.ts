/**
 * MessageType.CategoryRelabel: an admin renamed a video category (admin-api
 * /api/video-categories). Swaps the old labels for the new ones in the search
 * index text of the videos, then the channels, that have it: one page per
 * delivery, the next page queued (idempotent: a page already swapped no longer
 * ends with the old labels). A failure throws, so the queue retries with
 * backoff and then dead-letters it (stored, alerted, admin Errors page).
 */
import {
  MessageType,
  relabelCategoryPage,
  type CategoryRelabelPayload,
  type SearchDb,
} from '@al-ummah/shared-types';
import type { Logger } from '@al-ummah/logger';
import type { AlUmmahMessage, QueueEnvironment } from '../types';

export function isCategoryRelabelPayload(value: unknown): value is CategoryRelabelPayload {
  const p = value as CategoryRelabelPayload | null;
  const labels = (l: unknown) => !!l && typeof (l as { en?: unknown }).en === 'string' && typeof (l as { ar?: unknown }).ar === 'string';
  return !!p && typeof p.category === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(p.category)
    && (p.entity === 'video' || p.entity === 'channel') && labels(p.from) && labels(p.to);
}

export async function handleCategoryRelabel(message: AlUmmahMessage, env: QueueEnvironment, logger: Logger): Promise<void> {
  const payload = message.payload as unknown;
  if (!isCategoryRelabelPayload(payload)) throw new Error('CategoryRelabel message missing required fields: category, entity, from, to');
  const db = env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) {
    logger.warn('SEARCH_DB not bound, skipping category relabel', { category: payload.category });
    return;
  }
  let step: CategoryRelabelPayload | null = payload;
  while (step) {
    const next = await relabelCategoryPage(db, step);
    const following: CategoryRelabelPayload | null = next !== null
      ? { ...step, afterRowid: next }
      : step.entity === 'video' ? { ...step, entity: 'channel', afterRowid: 0 } : null;
    logger.debug('[CategoryRelabel] Page done', { category: step.category, entity: step.entity, next });
    if (!following) return;
    if (env.MESSAGE_QUEUE) {
      await env.MESSAGE_QUEUE.send({ ...message, type: MessageType.CategoryRelabel, payload: following as never, timestamp: new Date().toISOString() });
      return;
    }
    // No producer binding (local dev): every page inline
    step = following;
  }
}
