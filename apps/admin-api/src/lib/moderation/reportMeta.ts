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
 * values); user names follow the lookup (an erased user loses theirs). A person whose account was erased is
 * never read back: the lookup drops who they are and what they wrote (erased_users), whatever the index still says.
 */
import type { AdminLookupItem, AdminLookupRequest, AdminLookupResult, AdminLookupUser, ReportableEntityType } from '@al-ummah/shared-types';
import { ADMIN_LOOKUP_MAX_ITEMS, ADMIN_LOOKUP_MAX_USERS, eraseTombstoneKey } from '@al-ummah/shared-types';
import { callVideos, type VideosClientEnv } from '../content/videosClient';
import { erasedUserIds } from '../errors-store';
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

/** Items on someone else's channel: an erased author is not its owner, and they never get another author. */
const AUTHORED: ReadonlySet<string> = new Set(['comment', 'live_chat']);

/**
 * The lookup without people whose account was erased: by primary key in erased_users, and, for what they wrote,
 * by the mark their erasure left on the reports themselves (it stays when erased_users is purged at 30 days).
 */
export async function withoutErased(db: D1Database, lookup: Lookup): Promise<Lookup> {
  const ids = [...[...lookup.items.values()].map((i) => i.ownerId), ...[...lookup.users.values()].filter((u) => u.found).map((u) => u.id)];
  const erased = await erasedUserIds(db, ids.map((userId) => ({ userId: userId ?? undefined })));
  const authored = [...lookup.items.values()].filter((i) => i.found && AUTHORED.has(i.type)).map((i) => [i.type, i.id]);
  const marked = new Set<string>();
  if (authored.length) {
    const { results } = await db
      // From the items to their reports. +owner_id: never from the owner index, whose tombstone part only grows
      .prepare(
        `SELECT DISTINCT r.entity_type, r.entity_id FROM json_each(?) j CROSS JOIN reports r INDEXED BY idx_reports_entity
         ON r.entity_type = json_extract(j.value, '$[0]') AND r.entity_id = json_extract(j.value, '$[1]') WHERE +r.owner_id = ?`,
      )
      .bind(JSON.stringify(authored), DELETED_USER_ID)
      .all<{ entity_type: string; entity_id: string }>();
    for (const r of results ?? []) marked.add(itemKey(r.entity_type, r.entity_id));
  }
  if (erased.size === 0 && marked.size === 0) return lookup;
  const gone = (id: string | null) => !!id && erased.has(id);
  return {
    items: new Map([...lookup.items].map(([key, i]) => [key, gone(i.ownerId) || marked.has(key) ? { ...i, ownerId: DELETED_USER_ID, title: null, channelName: AUTHORED.has(i.type) ? i.channelName : null } : i])),
    users: new Map([...lookup.users].map(([id, u]) => [id, gone(id) ? { ...u, found: false, displayName: null, userName: null, email: null } : u])),
  };
}

/**
 * The WHERE of a write that names these people: not when one of them was erased since they were read. The erasure
 * records its tombstone first and clears the reports after, so a write is either refused or cleared.
 */
export const NOBODY_ERASED = 'NOT EXISTS (SELECT 1 FROM erased_users WHERE user_key IN (SELECT value FROM json_each(?)))';
export const erasedKeysOf = async (ids: Iterable<string | null | undefined>): Promise<string> =>
  JSON.stringify(await Promise.all([...new Set(ids)].filter((id): id is string => !!id && id !== DELETED_USER_ID).map((id) => eraseTombstoneKey(id))));

export const canLookup = (env: VideosClientEnv) => !!(env.VIDEOS || env.VIDEOS_API_URL);

/** One api-videos call for a page of items and users, without erased people. Null when that cannot be read (the caller shows the copies). */
export async function lookupMany(env: MetaEnv, items: { type: ReportableEntityType; id: string }[], users: string[]): Promise<Lookup | null> {
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
    const lookup: Lookup = {
      items: new Map(result.items.map((i) => [itemKey(i.type, i.id), i])),
      users: new Map(result.users.map((u) => [u.id, u])),
    };
    return await withoutErased(env.REPORTS_DB, lookup);
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
async function metaUpdate(db: D1Database, row: MetaRow, lookup: Lookup, now: string) {
  const item = lookup.items.get(itemKey(row.entity_type, row.entity_id));
  const found = !!item?.found;
  const ownerId = found ? item?.ownerId ?? null : row.owner_id;
  const names = { owner: userName(lookup, ownerId), reporter: userName(lookup, row.reporter_id), moderator: userName(lookup, row.moderator_id) };
  // Only whom this names: a moderator who is gone must not hold the row back
  const keys = await erasedKeysOf([found ? ownerId : null, names.owner && ownerId, names.reporter && row.reporter_id, names.moderator && row.moderator_id]);
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
       WHERE id = ?11 AND ${NOBODY_ERASED.replace('?', '?12')}`,
    )
    .bind(found ? 1 : 0, item?.title ?? null, item?.parentId ?? null, item?.channelId ?? null, item?.channelName ?? null, ownerId, names.owner, names.reporter, names.moderator, now, row.id, keys);
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
  await env.REPORTS_DB.batch(await Promise.all(rows.map((r) => metaUpdate(env.REPORTS_DB, r, lookup, now))));
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
