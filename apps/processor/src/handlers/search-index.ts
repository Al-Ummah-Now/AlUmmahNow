/**
 * Search index updates driven by queue messages (Story 29.9).
 *
 * api-videos updates the D1 search index itself on every R2 write. Workers
 * that write content without going through api-videos (scheduler publishing,
 * admin-api moderation) notify the processor instead:
 * - SearchIndexSync { entity, id, object? }: project the object into the index
 *   (no object = deleted)
 * - ReportResolve with action removed/banned: drop the moderated item
 *
 * Videos and channels also update the ownership index (content_ownership,
 * every object including private ones) that api-videos uses for owner and
 * channel listings. An ownership write that fails marks that index
 * incomplete, so api-videos scans R2 until its next rebuild pass.
 */

import {
  SEARCH_ENTITY_TYPES,
  SearchDb,
  SearchEntityType,
  SearchIndexSyncPayload,
  applyOwnershipModeration,
  invalidateOwnership,
  ownershipKindFor,
  removeSearchDocument,
  syncOwnershipSafely,
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
  const { entity, id, object, version: sent } = message.payload as unknown as SearchIndexSyncPayload;
  // Order guard (SCALABILITY-AUDIT PR-8): the version of the snapshot (its R2
  // `uploaded` time). A message without one only fills rows nothing newer wrote.
  const version = typeof sent === 'number' && Number.isFinite(sent) ? sent : 0;
  if (!entity || !id || !SEARCH_ENTITY_TYPES.includes(entity)) {
    throw new Error('SearchIndexSync message missing required fields: entity, id');
  }
  const db = searchDb(env);
  if (!db) {
    logger.warn('SEARCH_DB not bound, skipping search index sync', { entity, id });
    return;
  }
  const kind = ownershipKindFor(entity);
  if (kind) {
    const ownership = await syncOwnershipSafely(db, kind, id, object ?? null, Date.now(), version);
    if (ownership.ok === false) {
      logger.warn('Ownership index write failed; index marked incomplete', { entity, id, error: ownership.error, invalidated: ownership.invalidated });
    }
  }
  const result = await syncSearchDocument(db, entity, id, object ?? null, { version });
  logger.debug('Search index synced', { entity, id, version, result });
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
  const kind = ownershipKindFor(type);
  if (kind) {
    try {
      await applyOwnershipModeration(db, kind, payload.entityId, { hidden: true, deleted: payload.action === 'banned' });
    } catch (error) {
      logger.warn('Ownership moderation update failed; marking index incomplete', {
        kind,
        id: payload.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      await invalidateOwnership(db, kind).catch(() => undefined);
    }
  }
  const result = await removeSearchDocument(db, type, payload.entityId);
  logger.debug('Moderated content removed from search index', { type, id: payload.entityId, result });
}
