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

/** 'stale': a newer version of the item (or its delete) is already indexed; nothing written. */
export type SearchSyncResult = 'indexed' | 'unchanged' | 'hidden' | 'removed' | 'stale';

export interface SearchSyncOptions {
  /** Write even when the content hash is unchanged (backfill refreshes indexed_at). */
  force?: boolean;
  /** When unchanged, still refresh indexed_at so the reconciliation sweep does not prune the row. */
  touch?: boolean;
  now?: number;
  /**
   * Version of the object this write comes from: its R2 `uploaded` time
   * (epoch ms), or the delete time. Older versions than the indexed one, or
   * than the item's last delete, are not applied (SCALABILITY-AUDIT PR-8).
   * Defaults to `now`.
   */
  version?: number;
}

export const TOMBSTONE_TABLE = 'search_tombstones';
/** Tombstones older than this are pruned; no queued write lives that long. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** SQL condition: no delete of (?entity, ?id) at or after ?version. Binds: entity, id, version. */
export const NOT_TOMBSTONED = `NOT EXISTS (SELECT 1 FROM ${TOMBSTONE_TABLE} WHERE entity = ? AND id = ? AND version >= ?)`;

/** Records a delete (keeps the newest), so older snapshots stay out. */
export function tombstoneStatement(db: SearchDb, entity: string, id: string, version: number): SearchStatement {
  return db.prepare(
    `INSERT INTO ${TOMBSTONE_TABLE} (entity, id, version) VALUES (?, ?, ?)
     ON CONFLICT(entity, id) DO UPDATE SET version = max(version, excluded.version)`,
  ).bind(entity, id, version);
}

/** Version from an R2 object (`uploaded`), or undefined. */
export function r2Version(object: { uploaded?: Date | string | number } | null | undefined): number | undefined {
  const t = object?.uploaded === undefined ? NaN : new Date(object.uploaded).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** Queue payload for MessageType.SearchIndexSync (processor applies it). */
export interface SearchIndexSyncPayload {
  entity: SearchEntityType;
  id: string;
  /** Current stored object; null/absent means the object was deleted. */
  object?: unknown;
  /**
   * The object's R2 `uploaded` time (epoch ms) as returned by the put that
   * wrote it, or the delete time. Without it the processor uses 0: the write
   * then only fills rows no versioned write has touched.
   */
  version?: number;
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
  const version = options.version ?? now;

  // One lookup: the indexed row (if any) and the item's last delete
  const found = await db
    .prepare(
      `SELECT b.content_hash, b.source_version, b.views, b.popularity, b.payload,
         (SELECT version FROM ${TOMBSTONE_TABLE} WHERE entity = ? AND id = ?) AS tomb
       FROM (SELECT 1) LEFT JOIN ${base} b ON b.id = ?`,
    )
    .bind(row.type, row.id, row.id)
    .first<{ content_hash: string | null; source_version: number | null; views: number | null; popularity: number | null; payload: string | null; tomb: number | null }>();
  const existing = found && found.source_version !== null ? { content_hash: found.content_hash, source_version: Number(found.source_version) } : null;
  if ((found?.tomb != null && Number(found.tomb) >= version) || (existing && existing.source_version > version)) return 'stale';
  const payload = JSON.stringify(row.payload);
  if (!options.force && existing && existing.content_hash === hash && found) {
    if (Number(found.views) !== row.views || Number(found.popularity) !== row.popularity || found.payload !== payload) {
      // Only counters or display fields changed (a like, a flushed view count): one
      // UPDATE of the base row; the full-text entry stays as it is (AV-17).
      // Applied only if no newer version was committed meanwhile.
      const touch = options.touch ? ', indexed_at = ?' : '';
      const outcome = (await db
        .prepare(`UPDATE ${base} SET views = ?, popularity = ?, payload = ?, source_version = max(source_version, ?)${touch} WHERE id = ? AND source_version <= ?`)
        .bind(row.views, row.popularity, payload, version, ...(options.touch ? [now] : []), row.id, version)
        .run()) as { meta?: { changes?: number } };
      if (outcome?.meta?.changes === 0) return 'stale';
      return row.visible ? 'indexed' : 'hidden';
    }
    // Same content: still record the newer version, so an older write cannot slip in after it
    const sets = options.touch ? 'source_version = max(source_version, ?), indexed_at = ?' : 'source_version = max(source_version, ?)';
    const binds = options.touch ? [version, now, row.id] : [version, row.id];
    if (options.touch || existing.source_version < version) {
      await db.prepare(`UPDATE ${base} SET ${sets} WHERE id = ?`).bind(...binds).run();
    }
    return 'unchanged';
  }

  // The checks above are a shortcut; these statements enforce the order themselves,
  // in one transaction, against whatever another writer committed meanwhile.
  const ours = `(SELECT rowid FROM ${base} WHERE id = ? AND source_version = ?)`;
  const statements: SearchStatement[] = [
    db.prepare(
      `INSERT INTO ${base} (id, channel_id, visible, language, category, duration, is_verified, is_live, views, created_at, popularity, payload, content_hash, indexed_at, source_version, is_short)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${NOT_TOMBSTONED}
       ON CONFLICT(id) DO UPDATE SET
         channel_id = excluded.channel_id, visible = excluded.visible, language = excluded.language,
         category = excluded.category, duration = excluded.duration, is_verified = excluded.is_verified,
         is_live = excluded.is_live, views = excluded.views, created_at = excluded.created_at,
         popularity = excluded.popularity, payload = excluded.payload, content_hash = excluded.content_hash,
         indexed_at = excluded.indexed_at, source_version = excluded.source_version, is_short = excluded.is_short
       WHERE excluded.source_version >= ${base}.source_version`,
    ).bind(
      row.id, row.channelId, boolInt(row.visible), row.language, row.category, row.duration,
      boolInt(row.isVerified), boolInt(row.isLive), row.views, row.createdAt, row.popularity,
      payload, hash, now, version, boolInt(row.isShort),
      row.type, row.id, version,
    ),
    // Only if the base row now holds this version (the upsert above won)
    db.prepare(`DELETE FROM ${fts} WHERE rowid = ${ours}`).bind(row.id, version),
  ];
  if (row.visible) {
    statements.push(
      db.prepare(`INSERT INTO ${fts} (rowid, title, body) SELECT rowid, ?, ? FROM ${base} WHERE id = ? AND source_version = ?`)
        .bind(row.titleText, row.bodyText, row.id, version),
    );
  }
  await db.batch(statements);
  const after = await db.prepare(`SELECT source_version FROM ${base} WHERE id = ?`).bind(row.id).first<{ source_version: number }>();
  if (!after || Number(after.source_version) !== version) return 'stale';
  return row.visible ? 'indexed' : 'hidden';
}

/**
 * Remove an item from the index.
 *
 * `final` (the object was deleted from R2): always applies, whatever version
 * is indexed, since the worker's clock may trail R2's `uploaded` time of the
 * last write by a few ms; a deleted id is never written again.
 * Not final (the object exists but is not searchable, e.g. made private):
 * an ordinary version, applied only if not older than the indexed row.
 *
 * Either way it is remembered in search_tombstones, so an older snapshot
 * arriving later cannot bring the item back. Channels keep a hidden row so
 * the content they own stays excluded from results.
 */
export async function removeSearchDocument(
  db: SearchDb,
  type: SearchEntityType,
  id: string,
  now = Date.now(),
  version = now,
  final = true,
): Promise<SearchSyncResult> {
  const { base, fts } = SEARCH_TABLES[type];
  const current = await db.prepare(`SELECT source_version FROM ${base} WHERE id = ?`).bind(id).first<{ source_version: number }>();
  if (!final && current && Number(current.source_version) > version) return 'stale';
  const at = final ? Math.max(version, Number(current?.source_version ?? 0)) : version;
  // Re-checked inside the transaction for the non-final case
  const guard = final ? '' : ` AND source_version <= ${Number(at)}`;
  const statements: SearchStatement[] = [
    tombstoneStatement(db, type, id, at),
    db.prepare(`DELETE FROM ${fts} WHERE rowid = (SELECT rowid FROM ${base} WHERE id = ?${guard})`).bind(id),
  ];
  if (type === 'channel') {
    statements.push(
      db.prepare(
        `INSERT INTO ${base} (id, channel_id, visible, payload, content_hash, indexed_at, source_version) VALUES (?, ?, 0, '{}', 'removed', ?, ?)
         ON CONFLICT(id) DO UPDATE SET visible = 0, content_hash = 'removed', indexed_at = excluded.indexed_at, source_version = excluded.source_version
         ${final ? '' : `WHERE excluded.source_version >= ${base}.source_version`}`,
      ).bind(id, id, now, at),
    );
  } else {
    statements.push(db.prepare(`DELETE FROM ${base} WHERE id = ?${guard}`).bind(id));
  }
  await db.batch(statements);
  return type === 'channel' ? 'hidden' : 'removed';
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
  if (!row) {
    const now = options.now ?? Date.now();
    // Deleted (no object) is final; present but not searchable is an ordinary version
    return removeSearchDocument(db, type, id, now, options.version ?? now, object == null);
  }
  return upsertSearchRow(db, row, options);
}

/** Delete rows not refreshed since `before` (run after a full backfill pass). */
export async function pruneSearchIndex(db: SearchDb, type: SearchEntityType, before: number): Promise<void> {
  const { base, fts } = SEARCH_TABLES[type];
  await db.batch([
    db.prepare(`DELETE FROM ${fts} WHERE rowid IN (SELECT rowid FROM ${base} WHERE indexed_at < ?)`).bind(before),
    db.prepare(`DELETE FROM ${base} WHERE indexed_at < ?`).bind(before),
    db.prepare(`DELETE FROM ${TOMBSTONE_TABLE} WHERE entity IN (?, ?) AND version < ?`).bind(type, `own:${type}`, before - TOMBSTONE_RETENTION_MS),
  ]);
}
