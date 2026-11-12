/**
 * The name copies on report rows (migration 0020): item title, parent, channel,
 * owner, reporter and moderator names. The reports queue searches and shows
 * them without a call per row.
 *
 * Reports are filed by the processor, which knows only ids, so the copies are
 * filled here: before each queue read (bounded), on the 5-minute cron, and for
 * the items of a page just read (with their live data). The fill is
 * idempotent; meta_synced_at NULL means "not filled yet", and rows older than
 * REFRESH_MS are refreshed so renamed or erased users stop showing old names.
 * A removed item keeps the title it had (copies are only replaced by found
 * values); user names follow the lookup (an erased user loses theirs).
 */
import type { AdminLookupItem, AdminLookupRequest, AdminLookupResult, AdminLookupUser, ReportableEntityType } from '@al-ummah/shared-types';
import { ADMIN_LOOKUP_MAX_ITEMS, ADMIN_LOOKUP_MAX_USERS } from '@al-ummah/shared-types';
import { callVideos, type VideosClientEnv } from '../content/videosClient';
import { logger } from '../logger';
import type { D1Database } from '../types';

/** Rows filled per run (one lookup call; items and users stay under the lookup caps). */
export const SYNC_BATCH = 100;
/** Copies older than this are refreshed. */
export const REFRESH_MS = 24 * 60 * 60 * 1000;
/** The reporter id user erasure leaves on reports (processor DELETED_USER_ID). */
export const DELETED_USER_ID = 'deleted-user';

export type MetaEnv = VideosClientEnv & { REPORTS_DB: D1Database };

export interface Lookup {
  items: Map<string, AdminLookupItem>;
  users: Map<string, AdminLookupUser>;
}

export const itemKey = (type: string, id: string) => `${type}:${id}`;

export const canLookup = (env: VideosClientEnv) => !!(env.VIDEOS || env.VIDEOS_API_URL);

/** One api-videos call for a page of items and users. Null when api-videos cannot be reached (the caller shows the copies). */
export async function lookupMany(env: VideosClientEnv, items: { type: ReportableEntityType; id: string }[], users: string[]): Promise<Lookup | null> {
  if (!canLookup(env)) return null;
  const seen = new Set<string>();
  const uniqueItems = items.filter((i) => {
    const key = itemKey(i.type, i.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, ADMIN_LOOKUP_MAX_ITEMS);
  const uniqueUsers = [...new Set(users.filter((u) => u && u !== DELETED_USER_ID))].slice(0, ADMIN_LOOKUP_MAX_USERS);
  if (uniqueItems.length === 0 && uniqueUsers.length === 0) return { items: new Map(), users: new Map() };
  try {
    const body: AdminLookupRequest = { items: uniqueItems, users: uniqueUsers };
    const result = await callVideos<AdminLookupResult>(env, '/lookup', { method: 'POST', json: body });
    return {
      items: new Map(result.items.map((i) => [itemKey(i.type, i.id), i])),
      users: new Map(result.users.map((u) => [u.id, u])),
    };
  } catch (error) {
    logger.warn('[ReportQueue] Item lookup failed; showing the stored copies', { items: uniqueItems.length, users: uniqueUsers.length, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

interface MetaRow {
  id: string;
  entity_type: ReportableEntityType;
  entity_id: string;
  reporter_id: string;
  moderator_id: string | null;
  /** The owner copied before (kept for an item that is gone). */
  owner_id: string | null;
}

const userName = (lookup: Lookup, id: string | null): string | null => {
  if (!id) return null;
  const user = lookup.users.get(id);
  return user?.found ? user.displayName || user.userName || null : null;
};

/** The UPDATE for one row from a lookup. Item copies are kept when the item was not found. */
export function metaUpdate(db: D1Database, row: MetaRow, lookup: Lookup, now: string) {
  const item = lookup.items.get(itemKey(row.entity_type, row.entity_id));
  const found = !!item?.found;
  const ownerId = found ? item?.ownerId ?? null : row.owner_id;
  return db
    .prepare(
      `UPDATE reports SET
         entity_title = CASE WHEN ?1 THEN ?2 ELSE entity_title END,
         entity_parent_id = CASE WHEN ?1 THEN ?3 ELSE entity_parent_id END,
         channel_id = CASE WHEN ?1 THEN ?4 ELSE channel_id END,
         channel_name = CASE WHEN ?1 THEN ?5 ELSE channel_name END,
         owner_id = CASE WHEN ?1 THEN ?6 ELSE owner_id END,
         owner_name = ?7,
         reporter_name = ?8,
         moderator_name = ?9,
         meta_synced_at = ?10
       WHERE id = ?11`,
    )
    .bind(
      found ? 1 : 0,
      item?.title ?? null,
      item?.parentId ?? null,
      item?.channelId ?? null,
      item?.channelName ?? null,
      item?.ownerId ?? null,
      userName(lookup, ownerId),
      userName(lookup, row.reporter_id),
      userName(lookup, row.moderator_id),
      now,
      row.id,
    );
}

/**
 * Fills the copies of up to `limit` rows that were never filled or are stale
 * (never filled first). Returns how many rows it wrote; 0 when api-videos
 * cannot be reached (the rows stay due and the next run retries).
 */
export async function syncReportMeta(env: MetaEnv, opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = env.REPORTS_DB;
  const now = opts.now ?? new Date();
  // An erased reporter loses the name copy at once (the processor only swaps the id)
  await db.prepare('UPDATE reports SET reporter_name = NULL WHERE reporter_id = ? AND reporter_name IS NOT NULL').bind(DELETED_USER_ID).run();
  if (!canLookup(env)) return 0;
  const stale = new Date(now.getTime() - REFRESH_MS).toISOString();
  const { results = [] } = await db
    .prepare(
      `SELECT id, entity_type, entity_id, reporter_id, moderator_id, owner_id FROM reports
       WHERE meta_synced_at IS NULL OR meta_synced_at < ?
       ORDER BY meta_synced_at IS NOT NULL, meta_synced_at, created_at DESC LIMIT ?`,
    )
    .bind(stale, Math.min(opts.limit ?? SYNC_BATCH, SYNC_BATCH))
    .all<MetaRow>();
  if (results.length === 0) return 0;
  return writeMeta(env, results, now.toISOString());
}

export type { MetaRow };

async function writeMeta(env: MetaEnv, rows: MetaRow[], now: string): Promise<number> {
  const lookup = await lookupMany(
    env,
    rows.map((r) => ({ type: r.entity_type, id: r.entity_id })),
    rows.flatMap((r) => [r.reporter_id, r.moderator_id ?? '', r.owner_id ?? '']),
  );
  if (!lookup) return 0;
  await env.REPORTS_DB.batch(rows.map((r) => metaUpdate(env.REPORTS_DB, r, lookup, now)));
  logger.debug('[ReportQueue] Report copies filled', { rows: rows.length });
  return rows.length;
}

/** Cron: fill new reports' copies even when nobody opens the queue. */
export async function scheduledReportMetaSync(env: MetaEnv): Promise<void> {
  try {
    await syncReportMeta(env);
  } catch (error) {
    logger.error('[ReportQueue] Scheduled copy fill failed', { error: error instanceof Error ? error.message : String(error) });
  }
}
