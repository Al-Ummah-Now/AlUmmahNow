/**
 * Keeps the D1 search index in sync with R2 writes (Story 29.9).
 *
 * Instead of touching every endpoint that writes a video, channel, playlist or
 * community post, the Worker entry wraps those R2 bindings: after each
 * successful put/delete the affected index row is updated in the background
 * (ctx.waitUntil). Create, edit, delete, visibility and moderation changes
 * made through api-videos are therefore all covered, and writes that are not
 * indexable (likes/comments records, internal index objects) are ignored.
 *
 * Writes made by other workers reach the index through SearchIndexSync queue
 * messages (processor) and the daily reconciliation sweep (lib/search/backfill.ts).
 *
 * The ownership index (content_ownership, lib/search/ownership.ts) is updated
 * for videos and channels too, but inline before put/delete resolves, so a
 * client that creates a channel and immediately lists its channels sees it.
 *
 * A failed index write (ownership or search) never fails the request and
 * never marks a whole kind incomplete: the one object is recorded in
 * index_repairs and the repair job (lib/search/repairs.ts, admin-jobs queue,
 * backoff, Errors page with Retry) rewrites it from R2. Only when D1 refuses
 * that record too is the write handed to the processor queue (retries, DLQ).
 */

import {
  COMMUNITY_POST_KEY,
  SearchDb,
  SearchEntityType,
  MessageType,
  SearchIndexSyncPayload,
  ownershipKindFor,
  recordIndexRepair,
  type IndexRepairEntity,
  type IndexRepairReason,
  syncOwnership,
  r2Version,
  syncSearchDocument,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { syncCommentIndex } from '../admin/commentIndex';
import { kickRepairJob, type RepairJobEnv } from './repairs';

/** R2 binding name → indexed entity type. */
export const SEARCH_BUCKETS: Readonly<Record<string, SearchEntityType>> = {
  videos: 'video',
  channels: 'channel',
  playlists: 'playlist',
  community_posts: 'post',
};

const VIDEO_INTERNAL_PREFIXES = ['index:', 'metadata:', 'livestream:'];

/**
 * Map an R2 key to the entity id it stores, or null when the key does not hold
 * an indexable entity (e.g. `likes/...`, `index:recent-videos`).
 */
export function searchIdForKey(type: SearchEntityType, key: string): string | null {
  if (!key) return null;
  if (type === 'post') {
    const match = COMMUNITY_POST_KEY.exec(key);
    return match && match[2] !== 'index' ? match[2] : null;
  }
  if (key.includes('/')) return null;
  if (type === 'video' && VIDEO_INTERNAL_PREFIXES.some(prefix => key.startsWith(prefix))) return null;
  if (key.includes(':')) return null;
  return key;
}

function decodeValue(value: unknown): unknown | undefined {
  try {
    if (typeof value === 'string') return JSON.parse(value);
    if (value instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(value));
    if (ArrayBuffer.isView(value)) {
      return JSON.parse(new TextDecoder().decode(value as ArrayBufferView));
    }
  } catch {
    return null;
  }
  return undefined;
}

type ObjectSource = () => Promise<unknown>;

/** Queue producer binding (the processor applies SearchIndexSync messages, with retries). */
type QueueBinding = { send(message: unknown): Promise<unknown> };

/** What a failed index write needs to be repaired later. */
interface RepairContext {
  db: SearchDb;
  /** env.queue: the processor's queue, used only when D1 refuses the repair record */
  producer?: QueueBinding;
  /** ADMIN_JOBS_QUEUE + SEARCH_DB: starts the repair job */
  jobs: RepairJobEnv;
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * Hand one object whose index write failed to the repair path. Recorded in
 * index_repairs (the repair job re-reads it from R2 and rewrites both
 * indexes); when D1 refuses that record, sent to the processor as a
 * SearchIndexSync message (queue retries, then DLQ on the Errors page). When
 * both fail the write is logged as lost: the next reconcile pass rewrites it.
 * The kind is never marked incomplete.
 */
export async function repairLater(
  ctx: RepairContext,
  input: { entity: IndexRepairEntity; id: string; key?: string; reason: IndexRepairReason; error: string; object?: unknown; version?: number },
): Promise<'recorded' | 'queued' | 'lost'> {
  try {
    await recordIndexRepair(ctx.db, { entity: input.entity, id: input.id, key: input.key, reason: input.reason, error: input.error });
    ctx.waitUntil(kickRepairJob(ctx.jobs).catch(error => logger.warn('[SearchSync] Could not start the repair job', { error: error instanceof Error ? error.message : String(error) })));
    logger.warn('[SearchSync] Index write failed; object queued for repair', { entity: input.entity, id: input.id, reason: input.reason, error: input.error });
    return 'recorded';
  } catch (recordError) {
    // The processor syncs search entities; profiles and live streams are rewritten by the repair job only
    if (ctx.producer && input.entity !== 'profile' && input.entity !== 'stream') {
      try {
        const payload: SearchIndexSyncPayload = { entity: input.entity, id: input.id, object: input.object ?? null, version: input.version };
        await ctx.producer.send({ id: crypto.randomUUID(), type: MessageType.SearchIndexSync, payload, timestamp: Date.now() });
        logger.warn('[SearchSync] Index write failed; queued for the processor', { entity: input.entity, id: input.id, error: input.error });
        return 'queued';
      } catch (sendError) {
        logger.warn('[SearchSync] Could not queue the index write', { entity: input.entity, id: input.id, error: sendError instanceof Error ? sendError.message : String(sendError) });
      }
    }
    logger.error('[SearchSync] Index write lost; the next reconcile pass rewrites it', {
      alert: 'index_write_lost',
      entity: input.entity,
      id: input.id,
      error: input.error,
      recordError: recordError instanceof Error ? recordError.message : String(recordError),
    });
    return 'lost';
  }
}

/**
 * Per-request coordinator: serialises updates per key so the last write wins
 * even when one request writes the same object several times.
 */
export class SearchSyncQueue {
  private chains = new Map<string, Promise<void>>();

  constructor(private db: SearchDb, private waitUntil: (promise: Promise<unknown>) => void, private repair?: RepairContext) {}

  /** `version`: R2 `uploaded` time of the written object, or the delete time (PR-8 order guard). */
  enqueue(type: SearchEntityType, id: string, source: ObjectSource, version: number = Date.now(), key: string = id): void {
    const chainKey = `${type}:${id}`;
    const previous = this.chains.get(chainKey) ?? Promise.resolve();
    const next = previous.then(async () => {
      let object: unknown;
      try {
        object = await source();
        if (object && typeof object === 'object' && 'id' in object && (object as { id: unknown }).id !== id) {
          // Not the entity record for this id (some other JSON stored under an entity-like key).
          return;
        }
        const result = await syncSearchDocument(this.db, type, id, object ?? null, { version });
        logger.debug('[SearchSync] Index updated', { type, id, result });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!this.repair) {
          logger.warn('[SearchSync] Failed to update search index', { type, id, error: reason });
          return;
        }
        // One object, retried by the repair job (SCALABILITY-AUDIT follow-up #12): never only logged
        await repairLater(this.repair, { entity: type, id, key, reason: 'search-write', error: reason, object, version });
      }
    });
    this.chains.set(chainKey, next);
    this.waitUntil(next);
  }
}

/**
 * Write the ownership row inline. A failed write is repaired per object
 * (repairLater) instead of marking the whole index incomplete, which sent
 * every reader in every isolate to bucket scans at once (SCALABILITY-AUDIT AV-16).
 */
async function syncOwnershipInline(ctx: RepairContext, type: SearchEntityType, id: string, object: unknown, version: number): Promise<void> {
  const kind = ownershipKindFor(type);
  if (!kind) return;
  try {
    await syncOwnership(ctx.db, kind, id, object, Date.now(), version);
  } catch (error) {
    await repairLater(ctx, { entity: kind, id, reason: 'ownership-write', error: error instanceof Error ? error.message : String(error), object, version });
  }
}

/** Live stream records share the videos bucket (`livestream:<id>`); their ownership rows are kind 'stream'. */
const STREAM_KEY_PREFIX = 'livestream:';

function streamIdForKey(key: string): string | null {
  if (!key?.startsWith(STREAM_KEY_PREFIX)) return null;
  const id = key.slice(STREAM_KEY_PREFIX.length);
  return id && !id.includes('/') && !id.includes(':') ? id : null;
}

/** Ownership row of one live stream (never searchable). A failed write is repaired per object. */
async function syncStreamInline(ctx: RepairContext, id: string, key: string, object: unknown, version: number): Promise<void> {
  try {
    await syncOwnership(ctx.db, 'stream', id, object, Date.now(), version);
  } catch (error) {
    await repairLater(ctx, { entity: 'stream', id, key, reason: 'ownership-write', error: error instanceof Error ? error.message : String(error) });
  }
}

function wrapBucket(bucket: R2Bucket, type: SearchEntityType, queue: SearchSyncQueue, ctx: RepairContext): R2Bucket {
  const { db, waitUntil } = ctx;
  const tracksOwnership = ownershipKindFor(type) !== null;
  const tracksStreams = type === 'video';
  // Admin comment list (lib/admin/commentIndex.ts): video comments mirrored in D1, after the response
  const tracksComments = type === 'video';
  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === 'put') {
        return async (key: string, value: unknown, options?: R2PutOptions) => {
          const result = await target.put(key, value as Parameters<R2Bucket['put']>[1], options);
          const streamId = tracksStreams && result !== null ? streamIdForKey(key) : null;
          if (streamId) {
            let decoded = decodeValue(value);
            if (decoded === undefined) {
              const stored = await target.get(key).catch(() => null);
              decoded = stored ? await stored.json().catch(() => null) : null;
            }
            await syncStreamInline(ctx, streamId, key, decoded, r2Version(result as { uploaded?: Date } | undefined) ?? Date.now());
            return result;
          }
          const id = searchIdForKey(type, key);
          // R2 returns null when an onlyIf precondition prevented the write.
          if (id && result !== null) {
            // When R2 stored this write: a later write always has a later time
            const version = r2Version(result as { uploaded?: Date } | undefined) ?? Date.now();
            let decoded = decodeValue(value);
            if (decoded === undefined && tracksOwnership) {
              // Streams/blobs cannot be re-read from the argument: read the stored object once for both indexes.
              try {
                const stored = await target.get(key);
                decoded = stored ? await stored.json().catch(() => null) : null;
              } catch (error) {
                // The ownership row of this one object is rewritten by the repair job
                await repairLater(ctx, { entity: ownershipKindFor(type)!, id, key, reason: 'reread', error: error instanceof Error ? error.message : String(error) });
              }
            }
            if (tracksOwnership && decoded !== undefined) await syncOwnershipInline(ctx, type, id, decoded, version);
            if (tracksComments && decoded !== undefined) waitUntil(syncCommentIndex(db, id, decoded));
            queue.enqueue(type, id, decoded !== undefined
              ? async () => decoded
              : async () => {
                const stored = await target.get(key);
                return stored ? stored.json() : null;
              }, version, key);
          }
          return result;
        };
      }
      if (prop === 'delete') {
        return async (keys: string | string[]) => {
          await target.delete(keys);
          const version = Date.now();
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            const streamId = tracksStreams ? streamIdForKey(key) : null;
            if (streamId) {
              await syncStreamInline(ctx, streamId, key, null, version);
              continue;
            }
            const id = searchIdForKey(type, key);
            if (!id) continue;
            if (tracksOwnership) await syncOwnershipInline(ctx, type, id, null, version);
            if (tracksComments) waitUntil(syncCommentIndex(db, id, null));
            queue.enqueue(type, id, async () => null, version, key);
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Profiles are not searchable, but the admin's user list reads them from the
 * ownership index (kind 'profile'), so their puts and deletes keep that row current.
 */
function wrapProfiles(bucket: R2Bucket, ctx: RepairContext): R2Bucket {
  const sync = async (id: string, object: unknown, version: number) => {
    try {
      await syncOwnership(ctx.db, 'profile', id, object, Date.now(), version);
    } catch (error) {
      // This profile's row is rewritten by the repair job; the other profiles' rows stay trusted
      await repairLater(ctx, { entity: 'profile', id, reason: 'ownership-write', error: error instanceof Error ? error.message : String(error) });
    }
  };
  const idFor = (key: string) => (key && !key.includes('/') && !key.includes(':') ? key : null);
  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === 'put') {
        return async (key: string, value: unknown, options?: R2PutOptions) => {
          const result = await target.put(key, value as Parameters<R2Bucket['put']>[1], options);
          const id = idFor(key);
          if (id && result !== null) {
            let decoded = decodeValue(value);
            if (decoded === undefined) {
              const stored = await target.get(key).catch(() => null);
              decoded = stored ? await stored.json().catch(() => null) : null;
            }
            await sync(id, decoded, r2Version(result as { uploaded?: Date } | undefined) ?? Date.now());
          }
          return result;
        };
      }
      if (prop === 'delete') {
        return async (keys: string | string[]) => {
          await target.delete(keys);
          const version = Date.now();
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            const id = idFor(key);
            if (id) await sync(id, null, version);
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Return a copy of the Worker env whose content buckets update the search index
 * after writes. Returns env unchanged when SEARCH_DB is not bound.
 */
export function withSearchSync<E extends object>(env: E, ctx: Pick<ExecutionContext, 'waitUntil'>): E {
  const db = (env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
  if (!db || !ctx?.waitUntil) return env;
  const repair: RepairContext = {
    db,
    producer: (env as { queue?: QueueBinding }).queue,
    jobs: env as unknown as RepairJobEnv,
    waitUntil: promise => ctx.waitUntil(promise),
  };
  const queue = new SearchSyncQueue(db, promise => ctx.waitUntil(promise), repair);
  const wrapped: Record<string, unknown> = { ...(env as Record<string, unknown>) };
  for (const [binding, type] of Object.entries(SEARCH_BUCKETS)) {
    const bucket = wrapped[binding] as R2Bucket | undefined;
    if (bucket && typeof bucket.put === 'function') wrapped[binding] = wrapBucket(bucket, type, queue, repair);
  }
  const profiles = wrapped.profiles as R2Bucket | undefined;
  if (profiles && typeof profiles.put === 'function') wrapped.profiles = wrapProfiles(profiles, repair);
  return wrapped as E;
}
