/**
 * Search index backfill and reconciliation (Story 29.9).
 *
 * - `backfillSearchPage` indexes one page of an R2 bucket. POST
 *   /internal/search/backfill calls it repeatedly (cursor in, cursor out) to
 *   build the index from scratch.
 * - `runSearchPass` advances one entity's reconcile pass (cursor kept in
 *   search_meta). Each page reads back which indexable objects now have a row
 *   and queues the rest for the repair job (index_repairs); a finished pass
 *   prunes rows that were not seen (objects removed by other workers) and sets
 *   or clears the entity's drift flag (Errors page, Rebuild).
 * - Admin job 'search.reconcile' (`runSearchReconcileStep`) runs a whole pass
 *   in queued steps of RECONCILE_PAGES_PER_STEP pages; the daily cron queues
 *   one per entity (lib/search/reconcileJobs.ts). The old sweep did 300
 *   objects per entity per day: weeks for a large catalogue.
 */

import {
  COMMUNITY_POST_KEY,
  SEARCH_ENTITY_TYPES,
  SearchDb,
  SearchEntityType,
  SearchSyncResult,
  SEARCH_TABLES,
  indexRepairStatement,
  pendingRepairCount,
  pruneSearchIndex,
  r2Version,
  searchDriftKey,
  syncSearchDocument,
  type AdminJob,
  type SearchDrift,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { createJob, listJobs, type JobEnv, type JobOutcome } from '../admin/jobs';
import { SEARCH_BUCKETS, searchIdForKey } from './sync';

const BUCKET_FOR_TYPE: Record<SearchEntityType, string> = Object.fromEntries(
  Object.entries(SEARCH_BUCKETS).map(([binding, type]) => [type, binding]),
) as Record<SearchEntityType, string>;

export interface BackfillEnv {
  SEARCH_DB?: SearchDb;
  [binding: string]: unknown;
}

export interface BackfillPageResult {
  entity: SearchEntityType;
  scanned: number;
  indexed: number;
  hidden: number;
  removed: number;
  unchanged: number;
  /** A newer write was already indexed (PR-8) */
  stale: number;
  failed: number;
  /** Objects that project to a row (indexed, hidden, unchanged or stale): each must have one after the page */
  expectedIds: string[];
  /** Objects the page could not read or write */
  failedIds: string[];
  /** R2 keys by id (community posts are not keyed by id) */
  keys: Record<string, string>;
  nextCursor: string | null;
  done: boolean;
}

export const BACKFILL_MAX_PAGE = 100;

/**
 * Index one page of objects for an entity type.
 * `mode: 'force'` rewrites every row; `'touch'` only writes changed rows but refreshes indexed_at.
 */
export async function backfillSearchPage(
  env: BackfillEnv,
  entity: SearchEntityType,
  options: { cursor?: string | null; limit?: number; mode?: 'force' | 'touch'; now?: number } = {},
): Promise<BackfillPageResult> {
  const db = env.SEARCH_DB;
  const bucket = env[BUCKET_FOR_TYPE[entity]] as R2Bucket | undefined;
  if (!db || !bucket) throw new Error(`Search backfill unavailable: missing ${db ? BUCKET_FOR_TYPE[entity] : 'SEARCH_DB'} binding`);

  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), BACKFILL_MAX_PAGE);
  const page = await bucket.list({
    limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(entity === 'post' ? { prefix: 'posts/' } : {}),
  });
  const counts: Record<SearchSyncResult | 'failed', number> = { indexed: 0, hidden: 0, removed: 0, unchanged: 0, stale: 0, failed: 0 };
  let scanned = 0;
  const expectedIds: string[] = [];
  const failedIds: string[] = [];
  const keys: Record<string, string> = {};
  const now = options.now ?? Date.now();

  await Promise.all(page.objects.map(async object => {
    const key = object.key;
    if (entity === 'post' && !COMMUNITY_POST_KEY.test(key)) return;
    const id = searchIdForKey(entity, key);
    if (!id) return;
    scanned++;
    keys[id] = key;
    try {
      const stored = await bucket.get(key);
      const value = stored ? await stored.json<Record<string, unknown>>() : null;
      if (value && typeof value === 'object' && value.id !== undefined && value.id !== id) return;
      const version = r2Version(stored);
      const result = await syncSearchDocument(db, entity, id, value, {
        // When this copy was written (PR-8): a newer write indexed meanwhile is kept
        ...(version !== undefined ? { version } : {}),
        force: options.mode !== 'touch',
        touch: options.mode === 'touch',
        now,
      });
      counts[result]++;
      if (result !== 'removed') expectedIds.push(id);
      if (result === 'stale') {
        // A newer write is indexed: keep it, and mark it seen so the pass's prune keeps it
        await db.prepare(`UPDATE ${SEARCH_TABLES[entity].base} SET indexed_at = ? WHERE id = ? AND indexed_at < ?`).bind(now, id, now).run();
      }
    } catch (error) {
      counts.failed++;
      failedIds.push(id);
      logger.warn('[SearchBackfill] Failed to index object', {
        entity,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  const nextCursor = page.truncated ? (page as { cursor?: string }).cursor ?? null : null;
  return { entity, scanned, ...counts, expectedIds, failedIds, keys, nextCursor, done: !nextCursor };
}

interface SweepState {
  cursor: string | null;
  startedAt: number;
  /** Indexable objects read so far (absent in state saved by older builds) */
  expected?: number;
  failed?: number;
  sampleIds?: string[];
}

const sweepKey = (entity: SearchEntityType) => `sweep:${entity}`;

async function readState(db: SearchDb, entity: SearchEntityType): Promise<SweepState | null> {
  const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(sweepKey(entity)).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SweepState;
  } catch {
    return null;
  }
}

async function writeState(db: SearchDb, entity: SearchEntityType, state: SweepState | null, now: number): Promise<void> {
  if (!state) {
    await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(sweepKey(entity)).run();
    return;
  }
  await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(sweepKey(entity), JSON.stringify(state), now).run();
}

/** Bound parameters per read-back query (D1 allows 100). */
const VERIFY_CHUNK = 90;
const DRIFT_SAMPLE = 20;

export interface SearchPassResult {
  entity: SearchEntityType;
  pages: number;
  scanned: number;
  done: boolean;
  /** Objects this run queued for the repair job */
  queuedRepairs: number;
  /** Set when the pass finished: the drift it found, or null */
  drift?: SearchDrift | null;
}

/** Forget the entity's pass in progress (a fresh rebuild starts from the first key). */
export async function resetSearchPass(db: SearchDb, entity: SearchEntityType): Promise<void> {
  await writeState(db, entity, null, Date.now());
}

/**
 * Advance the entity's reconcile pass by up to `maxPages` pages (touch mode:
 * only changed rows are rewritten, every seen row is marked seen). Every
 * indexable object a page read must have a row afterwards; the ones without
 * (write refused or failed) and the unreadable ones are queued for the repair
 * job. A finished pass prunes rows not seen since it started and records the
 * drift flag.
 */
export async function runSearchPass(
  env: BackfillEnv,
  entity: SearchEntityType,
  options: { maxPages?: number; pageSize?: number; now?: () => number } = {},
): Promise<SearchPassResult> {
  const db = env.SEARCH_DB;
  const result: SearchPassResult = { entity, pages: 0, scanned: 0, done: false, queuedRepairs: 0 };
  if (!db || !env[BUCKET_FOR_TYPE[entity]]) return result;
  const clock = options.now ?? Date.now;
  const maxPages = Math.max(1, options.maxPages ?? 3);
  const { base } = SEARCH_TABLES[entity];
  let state: SweepState = (await readState(db, entity)) ?? { cursor: null, startedAt: clock(), expected: 0, failed: 0, sampleIds: [] };

  while (result.pages < maxPages) {
    const pageNow = clock();
    const page = await backfillSearchPage(env, entity, { cursor: state.cursor, limit: options.pageSize ?? BACKFILL_MAX_PAGE, mode: 'touch', now: pageNow });
    result.pages++;
    result.scanned += page.scanned;
    // Read back: each indexable object must now have a row seen by this page
    const seen = new Set<string>();
    for (let i = 0; i < page.expectedIds.length; i += VERIFY_CHUNK) {
      const chunk = page.expectedIds.slice(i, i + VERIFY_CHUNK);
      const { results } = await db.prepare(`SELECT id FROM ${base} WHERE indexed_at >= ? AND id IN (${chunk.map(() => '?').join(', ')})`)
        .bind(pageNow, ...chunk).all<{ id: string }>();
      for (const r of results ?? []) seen.add(r.id);
    }
    const missing = page.expectedIds.filter(id => !seen.has(id));
    const repairs = [
      ...missing.map(id => indexRepairStatement(db, { entity, id, key: page.keys[id], reason: 'pass-refused', error: 'the reconcile pass could not write the row' }, pageNow)),
      ...page.failedIds.map(id => indexRepairStatement(db, { entity, id, key: page.keys[id], reason: 'pass-unreadable', error: 'the reconcile pass could not read or index the object' }, pageNow)),
    ];
    for (let i = 0; i < repairs.length; i += 50) await db.batch(repairs.slice(i, i + 50));
    result.queuedRepairs += repairs.length;
    state = {
      ...state,
      cursor: page.nextCursor,
      expected: state.expected === undefined ? undefined : state.expected + page.expectedIds.length,
      failed: (state.failed ?? 0) + page.failedIds.length,
      sampleIds: [...(state.sampleIds ?? []), ...missing, ...page.failedIds].slice(0, DRIFT_SAMPLE),
    };
    if (page.done) {
      result.done = true;
      break;
    }
  }

  const now = clock();
  if (!result.done) {
    await writeState(db, entity, state, now);
    return result;
  }
  await pruneSearchIndex(db, entity, state.startedAt);
  await writeState(db, entity, null, now);
  result.drift = await recordSearchDrift(db, entity, state, now);
  logger.info('[SearchReconcile] Pass finished', { entity, startedAt: state.startedAt, expected: state.expected, failed: state.failed, drift: !!result.drift });
  return result;
}

/**
 * Compare the rows the finished pass saw with the indexable objects it read
 * (objects queued for repair are on their way, deleted ones rightly gone):
 * set the drift flag when rows are missing, clear it otherwise. A pass
 * resumed from an older build's state has no count and gives no verdict.
 */
async function recordSearchDrift(db: SearchDb, entity: SearchEntityType, state: SweepState, now: number): Promise<SearchDrift | null> {
  if (state.expected === undefined) return null;
  const { base } = SEARCH_TABLES[entity];
  const rows = await db.prepare(`SELECT COUNT(*) AS n FROM ${base} WHERE indexed_at >= ?`).bind(state.startedAt).first<{ n: number }>();
  const deleted = await db.prepare('SELECT COUNT(*) AS n FROM search_tombstones WHERE entity = ? AND version >= ? AND version <= ?')
    .bind(entity, state.startedAt, now).first<{ n: number }>();
  const indexed = Number(rows?.n ?? 0);
  const expected = Math.max(0, state.expected - Number(deleted?.n ?? 0));
  const queued = await pendingRepairCount(db, entity);
  if (indexed + queued >= expected) {
    await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(searchDriftKey(entity)).run();
    return null;
  }
  const drift: SearchDrift = { entity, expected, indexed, failed: state.failed ?? 0, sampleIds: state.sampleIds ?? [], at: new Date(now).toISOString() };
  await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(searchDriftKey(entity), JSON.stringify(drift), now).run();
  logger.warn('[SearchReconcile] Search index does not hold every indexable object', { alert: 'search_drift', ...drift });
  return drift;
}

/** Search drift flags of every entity (admin Errors page). */
export async function readSearchDrift(db: SearchDb): Promise<SearchDrift[]> {
  const { results } = await db.prepare(`SELECT value FROM search_meta WHERE key LIKE 'search:drift:%' ORDER BY key`).all<{ value: string }>();
  const out: SearchDrift[] = [];
  for (const row of results ?? []) {
    try {
      out.push(JSON.parse(row.value) as SearchDrift);
    } catch {
      // A malformed flag is rewritten by the next pass
    }
  }
  return out;
}

/**
 * Advance every entity's pass inline by a few pages (internal use and tests).
 * The daily cron queues the 'search.reconcile' job instead (reconcileJobs.ts).
 */
export async function reconcileSearchIndex(
  env: BackfillEnv,
  options: { pagesPerEntity?: number; pageSize?: number; now?: number } = {},
): Promise<Record<SearchEntityType, { scanned: number; pruned: boolean }>> {
  const summary = {} as Record<SearchEntityType, { scanned: number; pruned: boolean }>;
  if (!env.SEARCH_DB) return summary;
  for (const entity of SEARCH_ENTITY_TYPES) {
    const pass = await runSearchPass(env, entity, {
      maxPages: options.pagesPerEntity ?? 3,
      pageSize: options.pageSize,
      ...(options.now !== undefined ? { now: () => options.now! } : {}),
    });
    summary[entity] = { scanned: pass.scanned, pruned: pass.done };
  }
  logger.info('[SearchReconcile] Sweep finished', summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Admin job 'search.reconcile'
// ---------------------------------------------------------------------------

export const SEARCH_RECONCILE_JOB = 'search.reconcile' as const;
/** Bucket pages (100 objects) one job delivery walks. */
export const RECONCILE_PAGES_PER_STEP = 20;
export const searchReconcileTarget = (entity: SearchEntityType) => `search-index:${entity}`;

export function isSearchEntity(value: unknown): value is SearchEntityType {
  return typeof value === 'string' && (SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

export type SearchReconcileEnv = JobEnv & BackfillEnv;

/** The entity's latest reconcile jobs, newest first. */
export function searchReconcileJobs(env: SearchReconcileEnv, entity: SearchEntityType, limit = 5): Promise<AdminJob[]> {
  return listJobs(env, { targetKind: 'video', targetId: searchReconcileTarget(entity), limit });
}

/**
 * Queue a reconcile pass of one entity; an active one is returned instead.
 * `fresh` (the admin's Rebuild) starts from the first key; otherwise (cron)
 * the pass in progress resumes.
 */
export async function startSearchReconcile(env: SearchReconcileEnv, entity: SearchEntityType, actorId: string, options: { fresh?: boolean } = {}): Promise<{ job: AdminJob; existing: boolean }> {
  const active = (await searchReconcileJobs(env, entity)).find(job => job.status === 'queued' || job.status === 'running' || job.status === 'retrying');
  if (active) return { job: active, existing: true };
  const job = await createJob(env, {
    kind: SEARCH_RECONCILE_JOB,
    targetKind: 'video',
    targetId: searchReconcileTarget(entity),
    params: { entity, fresh: options.fresh === true },
    actorId,
  });
  logger.info('[SearchReconcile] Queued', { jobId: job.id, entity, status: job.status });
  return { job, existing: false };
}

/** One step of the job: RECONCILE_PAGES_PER_STEP pages, then the next step is queued until the pass is done. */
export async function runSearchReconcileStep(env: SearchReconcileEnv, job: AdminJob): Promise<JobOutcome> {
  const entity = job.params.entity;
  if (!isSearchEntity(entity)) throw new Error(`Unknown search entity: ${String(entity)}`);
  if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
  if (job.params.fresh === true) await resetSearchPass(env.SEARCH_DB, entity);
  const step = await runSearchPass(env, entity, { maxPages: RECONCILE_PAGES_PER_STEP, pageSize: BACKFILL_MAX_PAGE });
  const progress = {
    entity,
    pages: (Number(job.params.pages) || 0) + step.pages,
    scanned: (Number(job.params.scanned) || 0) + step.scanned,
    queuedRepairs: (Number(job.params.queuedRepairs) || 0) + step.queuedRepairs,
  };
  if (!step.done) return { done: false, params: { ...progress, fresh: false }, result: progress };
  if (step.drift) {
    const d = step.drift;
    // Retried with backoff (a new pass); after the last retry the job is failed and listed on the Errors page
    throw new Error(`The ${entity} search index is missing objects: ${d.expected} indexable, ${d.indexed} indexed${d.sampleIds.length ? ` (e.g. ${d.sampleIds.slice(0, 5).join(', ')})` : ''}`);
  }
  logger.info('[SearchReconcile] Done', { jobId: job.id, ...progress });
  return { done: true, result: progress };
}
