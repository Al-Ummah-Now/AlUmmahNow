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
 */

import {
  COMMUNITY_POST_KEY,
  SearchDb,
  SearchEntityType,
  syncSearchDocument,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

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

/**
 * Per-request coordinator: serialises updates per key so the last write wins
 * even when one request writes the same object several times.
 */
export class SearchSyncQueue {
  private chains = new Map<string, Promise<void>>();

  constructor(private db: SearchDb, private waitUntil: (promise: Promise<unknown>) => void) {}

  enqueue(type: SearchEntityType, id: string, source: ObjectSource): void {
    const chainKey = `${type}:${id}`;
    const previous = this.chains.get(chainKey) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const object = await source();
        if (object && typeof object === 'object' && 'id' in object && (object as { id: unknown }).id !== id) {
          // Not the entity record for this id (some other JSON stored under an entity-like key).
          return;
        }
        const result = await syncSearchDocument(this.db, type, id, object ?? null);
        logger.debug('[SearchSync] Index updated', { type, id, result });
      } catch (error) {
        logger.warn('[SearchSync] Failed to update search index', {
          type,
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.chains.set(chainKey, next);
    this.waitUntil(next);
  }
}

function wrapBucket(bucket: R2Bucket, type: SearchEntityType, queue: SearchSyncQueue): R2Bucket {
  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === 'put') {
        return async (key: string, value: unknown, options?: R2PutOptions) => {
          const result = await target.put(key, value as Parameters<R2Bucket['put']>[1], options);
          const id = searchIdForKey(type, key);
          // R2 returns null when an onlyIf precondition prevented the write.
          if (id && result !== null) {
            const decoded = decodeValue(value);
            queue.enqueue(type, id, decoded !== undefined
              ? async () => decoded
              : async () => {
                const stored = await target.get(key);
                return stored ? stored.json() : null;
              });
          }
          return result;
        };
      }
      if (prop === 'delete') {
        return async (keys: string | string[]) => {
          await target.delete(keys);
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            const id = searchIdForKey(type, key);
            if (id) queue.enqueue(type, id, async () => null);
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
  const queue = new SearchSyncQueue(db, promise => ctx.waitUntil(promise));
  const wrapped: Record<string, unknown> = { ...(env as Record<string, unknown>) };
  for (const [binding, type] of Object.entries(SEARCH_BUCKETS)) {
    const bucket = wrapped[binding] as R2Bucket | undefined;
    if (bucket && typeof bucket.put === 'function') wrapped[binding] = wrapBucket(bucket, type, queue);
  }
  return wrapped as E;
}
