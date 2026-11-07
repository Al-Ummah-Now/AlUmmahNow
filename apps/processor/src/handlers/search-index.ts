/**
 * Search index updates driven by queue messages (Story 29.9).
 *
 * api-videos updates the D1 search index itself on every R2 write. Workers
 * that write content without going through api-videos (scheduler publishing,
 * admin-api moderation) notify the processor instead:
 * - SearchIndexSync { entity, id, object? }: project the object into the index
 *   (no object = deleted)
 * - ReportResolve with action removed/banned: drop the moderated item
 */

import {
  SEARCH_ENTITY_TYPES,
  SearchDb,
  SearchEntityType,
  SearchIndexSyncPayload,
  removeSearchDocument,
  syncSearchDocument,
} from '@al-ummah/shared-types';
import type { Logger } from '@al-ummah/logger';
import type { AlUmmahMessage, QueueEnvironment } from '../types';

const REPORT_ENTITY_TYPES: Record<string, SearchEntityType> = {
  video: 'video',
  channel: 'channel',
  playlist: 'playlist',
  post: 'post',
  community_post: 'post',
};

function searchDb(env: QueueEnvironment): SearchDb | null {
  return (env.SEARCH_DB as unknown as SearchDb | undefined) ?? null;
}

export async function handleSearchIndexSync(message: AlUmmahMessage, env: QueueEnvironment, logger: Logger): Promise<void> {
  const { entity, id, object } = message.payload as unknown as SearchIndexSyncPayload;
  if (!entity || !id || !SEARCH_ENTITY_TYPES.includes(entity)) {
    throw new Error('SearchIndexSync message missing required fields: entity, id');
  }
  const db = searchDb(env);
  if (!db) {
    logger.warn('SEARCH_DB not bound, skipping search index sync', { entity, id });
    return;
  }
  const result = await syncSearchDocument(db, entity, id, object ?? null);
  logger.info('Search index synced', { entity, id, result });
}

/** Remove content a moderator removed or banned from the search index. */
export async function applyModerationToSearchIndex(
  payload: { entityType?: string | undefined; entityId?: string | undefined; action?: string | undefined },
  env: QueueEnvironment,
  logger: Logger,
): Promise<void> {
  if (payload.action !== 'removed' && payload.action !== 'banned') return;
  const type = payload.entityType ? REPORT_ENTITY_TYPES[payload.entityType] : undefined;
  const db = searchDb(env);
  if (!type || !payload.entityId || !db) return;
  const result = await removeSearchDocument(db, type, payload.entityId);
  logger.info('Moderated content removed from search index', { type, id: payload.entityId, result });
}
