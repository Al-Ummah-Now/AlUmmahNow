/**
 * Search index backfill and reconciliation (Story 29.9).
 *
 * - `backfillSearchPage` indexes one page of an R2 bucket. POST
 *   /internal/search/backfill calls it repeatedly (cursor in, cursor out) to
 *   build the index from scratch.
 * - `reconcileSearchIndex` runs from the daily cron: it walks each bucket a few
 *   pages per run, refreshing rows, and when a full pass of a bucket completes
 *   it prunes rows that were not seen (objects removed by other workers).
 */

import {
  COMMUNITY_POST_KEY,
  SEARCH_ENTITY_TYPES,
  SearchDb,
  SearchEntityType,
  SearchSyncResult,
  pruneSearchIndex,
  syncSearchDocument,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
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
  failed: number;
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
  const counts: Record<SearchSyncResult | 'failed', number> = { indexed: 0, hidden: 0, removed: 0, unchanged: 0, failed: 0 };
  let scanned = 0;

  await Promise.all(page.objects.map(async object => {
    const key = object.key;
    if (entity === 'post' && !COMMUNITY_POST_KEY.test(key)) return;
    const id = searchIdForKey(entity, key);
    if (!id) return;
    scanned++;
    try {
      const stored = await bucket.get(key);
      const value = stored ? await stored.json<Record<string, unknown>>() : null;
      if (value && typeof value === 'object' && value.id !== undefined && value.id !== id) return;
      const result = await syncSearchDocument(db, entity, id, value, {
        force: options.mode !== 'touch',
        touch: options.mode === 'touch',
        now: options.now,
      });
      counts[result]++;
    } catch (error) {
      counts.failed++;
      logger.warn('[SearchBackfill] Failed to index object', {
        entity,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  const nextCursor = page.truncated ? (page as { cursor?: string }).cursor ?? null : null;
  return { entity, scanned, ...counts, nextCursor, done: !nextCursor };
}

interface SweepState {
  cursor: string | null;
  startedAt: number;
}

async function readState(db: SearchDb, entity: SearchEntityType): Promise<SweepState | null> {
  const row = await db.prepare('SELECT value FROM search_meta WHERE key = ?').bind(`sweep:${entity}`).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SweepState;
  } catch {
    return null;
  }
}

async function writeState(db: SearchDb, entity: SearchEntityType, state: SweepState | null, now: number): Promise<void> {
  if (!state) {
    await db.prepare('DELETE FROM search_meta WHERE key = ?').bind(`sweep:${entity}`).run();
    return;
  }
  await db.prepare(
    `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(`sweep:${entity}`, JSON.stringify(state), now).run();
}

/**
 * Daily reconciliation: up to `pagesPerEntity` pages per entity type per run.
 * Prunes rows older than the pass start once a bucket has been fully walked.
 */
export async function reconcileSearchIndex(
  env: BackfillEnv,
  options: { pagesPerEntity?: number; pageSize?: number; now?: number } = {},
): Promise<Record<SearchEntityType, { scanned: number; pruned: boolean }>> {
  const db = env.SEARCH_DB;
  const summary = {} as Record<SearchEntityType, { scanned: number; pruned: boolean }>;
  if (!db) return summary;
  const now = options.now ?? Date.now();
  const pages = options.pagesPerEntity ?? 3;

  for (const entity of SEARCH_ENTITY_TYPES) {
    summary[entity] = { scanned: 0, pruned: false };
    if (!env[BUCKET_FOR_TYPE[entity]]) continue;
    let state: SweepState | null = (await readState(db, entity)) ?? { cursor: null, startedAt: now };
    for (let i = 0; i < pages; i++) {
      const result = await backfillSearchPage(env, entity, { cursor: state.cursor, limit: options.pageSize ?? BACKFILL_MAX_PAGE, mode: 'touch', now });
      summary[entity].scanned += result.scanned;
      if (result.done) {
        await pruneSearchIndex(db, entity, state.startedAt);
        summary[entity].pruned = true;
        state = null;
        break;
      }
      state = { ...state, cursor: result.nextCursor };
    }
    await writeState(db, entity, state, now);
  }
  logger.info('[SearchReconcile] Sweep finished', summary);
  return summary;
}
