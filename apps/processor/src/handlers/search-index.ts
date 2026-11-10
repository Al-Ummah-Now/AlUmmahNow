/**
 * Search index updates driven by queue messages (Story 29.9).
 *
 * api-videos updates the D1 search index itself on every R2 write. Workers
 * that write content without going through api-videos (scheduler publishing,
 * admin-api moderation) notify the processor instead:
 * - SearchIndexSync { entity, id, object? }: project the object into the index
 *   (no object = deleted)
 * - ReportResolve with action removed/banned/deleted: drop the moderated item
 *   (deleted = removed permanently; banned = its owner was banned, the item hidden)
 *
 * Videos and channels also update the ownership index (content_ownership,
 * every object including private ones) that api-videos uses for owner and
 * channel listings.
 *
 * A write that fails is one object's problem: it is recorded in index_repairs
 * and the api-videos repair job (lib/search/repairs.ts; its 10-minute cron
 * starts it) re-reads the object from R2 and rewrites it, with backoff and an
 * Errors page entry with Retry. When D1 refuses that record too, the handler
 * throws, so this queue retries the message and finally dead-letters it
 * (Errors page, Replay). The index is never marked incomplete.
 */

import {
  SEARCH_ENTITY_TYPES,
  SearchDb,
  SearchEntityType,
  SearchIndexSyncPayload,
  applyOwnershipModeration,
  loadVideoCategories,
  ownershipKindFor,
  recordIndexRepair,
  removeSearchDocument,
  syncOwnership,
  syncSearchDocument,
  channelSubscriberCount,
  refreshChannelSubscribers,
  type IndexRepairEntity,
  type IndexRepairReason,
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

/**
 * Hand a failed index write to the repair job. Throws `error` when it cannot be
 * recorded, so the queue retries the message (then DLQ).
 */
export async function repairOrThrow(
  db: SearchDb,
  input: { entity: IndexRepairEntity; id: string; key?: string; reason: IndexRepairReason },
  error: unknown,
  logger: Logger,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await recordIndexRepair(db, { ...input, error: message });
  } catch (recordError) {
    logger.warn('Index write failed and could not be queued for repair; retrying the message', {
      ...input,
      error: message,
      recordError: recordError instanceof Error ? recordError.message : String(recordError),
    });
    throw error;
  }
  logger.warn('Index write failed; object queued for repair', { ...input, error: message });
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
  // Community posts are stored at posts/<channelId>/<id>.json
  const channelId = (object as { channelId?: unknown } | null | undefined)?.channelId;
  const key = entity === 'post' && typeof channelId === 'string' ? `posts/${channelId}/${id}.json` : id;
  if (kind) {
    try {
      await syncOwnership(db, kind, id, object ?? null, Date.now(), version);
    } catch (error) {
      await repairOrThrow(db, { entity: kind, id, key, reason: 'ownership-write' }, error, logger);
    }
  }
  // Category labels in the index text come from the admin-managed list
  await loadVideoCategories(db);
  try {
    // A channel carries its live subscriber count (D1), never the frozen one on the R2 object (#1633)
    const subscribers = entity === 'channel' && object ? await channelSubscriberCount(env.NOTIFICATIONS_DB, id) : undefined;
    const result = await syncSearchDocument(db, entity, id, object ?? null, { version, ...(subscribers !== undefined ? { subscribers } : {}) });
    logger.debug('Search index synced', { entity, id, version, result });
  } catch (error) {
    await repairOrThrow(db, { entity, id, key, reason: 'search-write' }, error, logger);
  }
}

/**
 * After a subscribe or unsubscribe: the channel's indexed subscriber count and popularity follow
 * the live D1 count (#1633), so Explore, search and suggestions show it. Throws on a D1 failure,
 * so the queue retries the message (the subscription itself is already stored).
 */
export async function refreshChannelSearchSubscribers(env: QueueEnvironment, channelId: string, logger: Logger): Promise<void> {
  const db = searchDb(env);
  if (!db || !env.NOTIFICATIONS_DB) return;
  const subscribers = await channelSubscriberCount(env.NOTIFICATIONS_DB, channelId);
  if (subscribers === undefined) return;
  const result = await refreshChannelSubscribers(db, channelId, subscribers);
  logger.debug('Channel subscriber count refreshed in the search index', { channelId, subscribers, result });
}

/** Remove content a moderator removed, deleted or whose owner a moderator banned from the search index. */
export async function applyModerationToSearchIndex(
  payload: { entityType?: string | undefined; entityId?: string | undefined; action?: string | undefined },
  env: QueueEnvironment,
  logger: Logger,
): Promise<void> {
  if (payload.action !== 'removed' && payload.action !== 'banned' && payload.action !== 'deleted') return;
  const type = payload.entityType ? REPORT_ENTITY_TYPES[payload.entityType] : undefined;
  const db = searchDb(env);
  if (!type || !payload.entityId || !db) return;
  const kind = ownershipKindFor(type);
  if (kind) {
    try {
      await applyOwnershipModeration(db, kind, payload.entityId, { hidden: true, deleted: payload.action === 'deleted' });
    } catch (error) {
      // The repair job re-reads the moderated object (flags already in R2) and rewrites its row
      await repairOrThrow(db, { entity: kind, id: payload.entityId, reason: 'moderation' }, error, logger);
    }
  }
  try {
    const result = await removeSearchDocument(db, type, payload.entityId);
    logger.debug('Moderated content removed from search index', { type, id: payload.entityId, result });
  } catch (error) {
    await repairOrThrow(db, { entity: type, id: payload.entityId, reason: 'moderation' }, error, logger);
  }
}
