/**
 * D1 writes for the search index (Story 29.9).
 *
 * Each entity type has a base table (filter/sort columns + JSON payload) and
 * an FTS5 table whose rowid equals the base row's rowid, so updates and
 * deletes hit the FTS table by rowid instead of scanning it.
 * Schema: apps/api-videos/migrations/search/0001_search_index.sql
 */

import { SEARCH_TABLES, SearchEntityType, SearchRow, projectSearchDocument, searchRowHash } from './documents';

/** Minimal D1 surface used by the search index (structurally compatible with Cloudflare's D1Database). */
export interface SearchDb {
  prepare(sql: string): SearchStatement;
  batch(statements: SearchStatement[]): Promise<unknown[]>;
}

export interface SearchStatement {
  bind(...values: unknown[]): SearchStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export type SearchSyncResult = 'indexed' | 'unchanged' | 'hidden' | 'removed';

export interface SearchSyncOptions {
  /** Write even when the content hash is unchanged (backfill refreshes indexed_at). */
  force?: boolean;
  /** When unchanged, still refresh indexed_at so the reconciliation sweep does not prune the row. */
  touch?: boolean;
  now?: number;
}

/** Queue payload for MessageType.SearchIndexSync (processor applies it). */
export interface SearchIndexSyncPayload {
  entity: SearchEntityType;
  id: string;
  /** Current stored object; null/absent means the object was deleted. */
  object?: unknown;
}

function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Insert or update a projected row. A row with `visible = false` (non-public
 * channel) keeps its base row but has no full-text entry.
 */
export async function upsertSearchRow(db: SearchDb, row: SearchRow, options: SearchSyncOptions = {}): Promise<SearchSyncResult> {
  const { base, fts } = SEARCH_TABLES[row.type];
  const hash = searchRowHash(row);
  const now = options.now ?? Date.now();

  if (!options.force) {
    const existing = await db.prepare(`SELECT content_hash FROM ${base} WHERE id = ?`).bind(row.id).first<{ content_hash: string }>();
    if (existing && existing.content_hash === hash) {
      if (options.touch) await db.prepare(`UPDATE ${base} SET indexed_at = ? WHERE id = ?`).bind(now, row.id).run();
      return 'unchanged';
    }
  }

  const statements: SearchStatement[] = [
    db.prepare(
      `INSERT INTO ${base} (id, channel_id, visible, language, category, duration, is_verified, is_live, views, created_at, popularity, payload, content_hash, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         channel_id = excluded.channel_id, visible = excluded.visible, language = excluded.language,
         category = excluded.category, duration = excluded.duration, is_verified = excluded.is_verified,
         is_live = excluded.is_live, views = excluded.views, created_at = excluded.created_at,
         popularity = excluded.popularity, payload = excluded.payload, content_hash = excluded.content_hash,
         indexed_at = excluded.indexed_at`,
    ).bind(
      row.id, row.channelId, boolInt(row.visible), row.language, row.category, row.duration,
      boolInt(row.isVerified), boolInt(row.isLive), row.views, row.createdAt, row.popularity,
      JSON.stringify(row.payload), hash, now,
    ),
    db.prepare(`DELETE FROM ${fts} WHERE rowid = (SELECT rowid FROM ${base} WHERE id = ?)`).bind(row.id),
  ];
  if (row.visible) {
    statements.push(
      db.prepare(`INSERT INTO ${fts} (rowid, title, body) SELECT rowid, ?, ? FROM ${base} WHERE id = ?`)
        .bind(row.titleText, row.bodyText, row.id),
    );
  }
  await db.batch(statements);
  return row.visible ? 'indexed' : 'hidden';
}

/**
 * Remove an item from the index. Channels keep a hidden tombstone row so the
 * content they own stays excluded from results.
 */
export async function removeSearchDocument(db: SearchDb, type: SearchEntityType, id: string, now = Date.now()): Promise<SearchSyncResult> {
  const { base, fts } = SEARCH_TABLES[type];
  const deleteFts = db.prepare(`DELETE FROM ${fts} WHERE rowid = (SELECT rowid FROM ${base} WHERE id = ?)`).bind(id);
  if (type === 'channel') {
    await db.batch([
      deleteFts,
      db.prepare(
        `INSERT INTO ${base} (id, channel_id, visible, payload, content_hash, indexed_at) VALUES (?, ?, 0, '{}', 'removed', ?)
         ON CONFLICT(id) DO UPDATE SET visible = 0, content_hash = 'removed', indexed_at = excluded.indexed_at`,
      ).bind(id, id, now),
    ]);
    return 'hidden';
  }
  await db.batch([deleteFts, db.prepare(`DELETE FROM ${base} WHERE id = ?`).bind(id)]);
  return 'removed';
}

/**
 * Bring the index in line with the current stored object (null = deleted).
 */
export async function syncSearchDocument(
  db: SearchDb,
  type: SearchEntityType,
  id: string,
  object: unknown,
  options: SearchSyncOptions = {},
): Promise<SearchSyncResult> {
  const row = object == null ? null : projectSearchDocument(type, object);
  if (!row) return removeSearchDocument(db, type, id, options.now);
  return upsertSearchRow(db, row, options);
}

/** Delete rows not refreshed since `before` (run after a full backfill pass). */
export async function pruneSearchIndex(db: SearchDb, type: SearchEntityType, before: number): Promise<void> {
  const { base, fts } = SEARCH_TABLES[type];
  await db.batch([
    db.prepare(`DELETE FROM ${fts} WHERE rowid IN (SELECT rowid FROM ${base} WHERE indexed_at < ?)`).bind(before),
    db.prepare(`DELETE FROM ${base} WHERE indexed_at < ?`).bind(before),
  ]);
}
