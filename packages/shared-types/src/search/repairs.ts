/**
 * Per-object index repairs (apps/api-videos/migrations/search/0012_index_repairs.sql).
 *
 * When one write to the ownership or search index fails, that object is
 * recorded here instead of marking the whole kind incomplete (which sent
 * every reader to R2 scans until the next full pass). The api-videos admin
 * job 'search.repair-objects' (lib/search/repairs.ts) re-reads each recorded
 * object from R2 and rewrites both indexes, backing off between attempts;
 * after REPAIR_MAX_ATTEMPTS the row is 'failed' and the admin Errors page
 * lists it with Retry.
 *
 * Shared so api-videos (inline writes, passes) and the processor (queue
 * writes) record the same rows.
 */

import type { SearchDb, SearchStatement } from './store';
import type { SearchEntityType } from './documents';

export const INDEX_REPAIRS_TABLE = 'index_repairs';

/** Entities a repair covers: the searchable types plus profiles (ownership only). */
export type IndexRepairEntity = SearchEntityType | 'profile';
export const INDEX_REPAIR_ENTITIES: ReadonlyArray<IndexRepairEntity> = ['video', 'channel', 'playlist', 'post', 'profile'];

/** Attempts before a repair is 'failed' and waits for an admin's Retry. */
export const REPAIR_MAX_ATTEMPTS = 6;

/** Why the object was recorded (shown on the Errors page). */
export type IndexRepairReason =
  | 'ownership-write'
  | 'search-write'
  | 'reread'
  | 'pass-unreadable'
  | 'pass-refused'
  | 'queue-dead-letter'
  | 'moderation';

export interface IndexRepair {
  entity: IndexRepairEntity;
  id: string;
  key: string;
  status: 'pending' | 'failed';
  attempts: number;
  reason: IndexRepairReason;
  lastError: string | null;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
}

/** R2 key of an entity's object (community posts live at posts/<channelId>/<postId>.json). */
export function repairKeyFor(entity: IndexRepairEntity, id: string, channelId?: string | null): string {
  return entity === 'post' && channelId ? `posts/${channelId}/${id}.json` : id;
}

/** Backoff before the next attempt: 1, 2, 4, 8, 16 minutes, capped at 30. */
export function repairBackoffMs(attempts: number): number {
  return Math.min(30, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/**
 * Statement that records (or re-arms) a repair. A failed row that fails again
 * from a new write goes back to pending with a fresh budget: the new write is
 * a new reason to try.
 */
export function indexRepairStatement(
  db: SearchDb,
  input: { entity: IndexRepairEntity; id: string; key?: string; reason: IndexRepairReason; error?: string | null },
  now = Date.now(),
): SearchStatement {
  return db.prepare(
    `INSERT INTO ${INDEX_REPAIRS_TABLE} (entity, id, r2_key, status, attempts, reason, last_error, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)
     ON CONFLICT(entity, id) DO UPDATE SET
       r2_key = excluded.r2_key,
       last_error = COALESCE(excluded.last_error, ${INDEX_REPAIRS_TABLE}.last_error),
       status = 'pending',
       attempts = CASE WHEN ${INDEX_REPAIRS_TABLE}.status = 'failed' THEN 0 ELSE ${INDEX_REPAIRS_TABLE}.attempts END,
       next_attempt_at = CASE WHEN ${INDEX_REPAIRS_TABLE}.status = 'failed' THEN excluded.next_attempt_at ELSE ${INDEX_REPAIRS_TABLE}.next_attempt_at END,
       updated_at = excluded.updated_at`,
  ).bind(
    input.entity,
    input.id,
    input.key ?? input.id,
    input.reason,
    input.error ? input.error.slice(0, 500) : null,
    now,
    now,
    now,
  );
}

/** Records one repair. Throws when D1 refuses (the caller then has no durable record). */
export async function recordIndexRepair(
  db: SearchDb,
  input: { entity: IndexRepairEntity; id: string; key?: string; reason: IndexRepairReason; error?: string | null },
  now = Date.now(),
): Promise<void> {
  await indexRepairStatement(db, input, now).run();
}

/** Pending (not failed) repairs of one entity: a pass counts them as on their way, not missing. */
export async function pendingRepairCount(db: SearchDb, entity: IndexRepairEntity): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${INDEX_REPAIRS_TABLE} WHERE entity = ? AND status = 'pending'`)
    .bind(entity).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * search_meta key of the search index drift flag of one entity type, set by a
 * finished search reconcile pass that found rows missing (see SearchDrift).
 */
export function searchDriftKey(entity: SearchEntityType): string {
  return `search:drift:${entity}`;
}

/**
 * Set by a finished search reconcile pass when the search index holds fewer
 * rows than the indexable objects it read (minus objects queued for repair);
 * cleared by the next pass that finds them all. Shown on the admin Errors
 * page with a Rebuild that queues the 'search.reconcile' admin job.
 */
export interface SearchDrift {
  entity: SearchEntityType;
  /** Indexable objects the pass read */
  expected: number;
  /** Rows refreshed by the pass */
  indexed: number;
  /** Objects the pass could not read or write (queued for repair) */
  failed: number;
  /** Up to 20 ids of objects without a row */
  sampleIds: string[];
  at: string;
}
