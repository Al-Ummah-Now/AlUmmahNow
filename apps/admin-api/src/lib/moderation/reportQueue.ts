/**
 * The reports queue (shared-types report-queue.ts): Action needed (open
 * reports grouped per item) and History (closed reports), with one search and
 * filter model, read from REPORTS_DB.
 *
 * Search runs in D1 over the copies kept on each report (lib/moderation/
 * reportMeta.ts); the page's items are then looked up live in one api-videos
 * call (title, channel, owner, ban state), falling back to the copies.
 *
 * A group matches when ANY of its open reports matches the filters, and then
 * shows ALL its open reports (counts, reasons), so searching a reporter's name
 * finds the item without hiding the other reports about it.
 */
import {
  REPORT_ENTITY_TYPES,
  REPORT_GROUP_LATEST,
  REPORT_HISTORY_SORTS,
  REPORT_OUTCOMES,
  REPORT_QUEUE_DEFAULT_PAGE_SIZE,
  REPORT_QUEUE_MAX_PAGE_SIZE,
  REPORT_QUEUE_SORTS,
  REPORT_REASONS,
  type ModerationAction,
  type ReportableEntityType,
  type ReportAiSummary,
  type ReportExcerpt,
  type ReportGroup,
  type ReportHistoryQuery,
  type ReportHistoryRow,
  type ReportItemResult,
  type ReportQueueCounts,
  type ReportQueueFilters,
  type ReportQueueQuery,
  type ReportReason,
  type ReportedItemSummary,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import { itemKey, lookupMany, type Lookup, type MetaEnv } from './reportMeta';
import { logger } from '../logger';

export const OPEN = "('pending', 'reviewing')";
export const CLOSED = "('resolved', 'dismissed')";

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export class QueueQueryError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?$/;

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new QueueQueryError(`${name}: must be one of ${allowed.join(', ')}`);
  return value as T;
}

function dateOf(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!DATE.test(value) || Number.isNaN(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value))) throw new QueueQueryError(`${name}: must be a date (YYYY-MM-DD) or ISO timestamp`);
  return value;
}

function intOf(name: string, value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new QueueQueryError(`${name}: must be a positive whole number`);
  return Math.min(n, max);
}

function filtersOf(query: Record<string, string | undefined>): Required<Pick<ReportQueueFilters, 'page' | 'pageSize'>> & ReportQueueFilters {
  const q = query.q?.trim().slice(0, 200) || undefined;
  return {
    q,
    entityType: oneOf('entityType', query.entityType, REPORT_ENTITY_TYPES),
    reason: oneOf('reason', query.reason, REPORT_REASONS),
    from: dateOf('from', query.from),
    to: dateOf('to', query.to),
    page: intOf('page', query.page, 1, 100_000),
    pageSize: intOf('pageSize', query.pageSize, REPORT_QUEUE_DEFAULT_PAGE_SIZE, REPORT_QUEUE_MAX_PAGE_SIZE),
  };
}

export function parseQueueQuery(query: Record<string, string | undefined>): ReportQueueQuery & { page: number; pageSize: number } {
  return { ...filtersOf(query), sort: oneOf('sort', query.sort, REPORT_QUEUE_SORTS) ?? 'oldest' };
}

export function parseHistoryQuery(query: Record<string, string | undefined>): ReportHistoryQuery & { page: number; pageSize: number } {
  return {
    ...filtersOf(query),
    action: oneOf('action', query.action, REPORT_OUTCOMES),
    moderatorId: query.moderatorId?.trim().slice(0, 200) || undefined,
    sort: oneOf('sort', query.sort, REPORT_HISTORY_SORTS) ?? 'newest',
  };
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

export interface Where {
  sql: string[];
  binds: unknown[];
}

/** `%term%` with LIKE wildcards escaped (ESCAPE '\'), lower-cased like the columns it is compared with. */
export function likeTerm(q: string): string {
  return `%${q.trim().toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** A bare date as `to` means up to the end of that day. */
export function endOf(to: string): string {
  if (to.length !== 10) return to;
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const TEXT_COLUMNS = ['entity_title', 'channel_name', 'owner_name', 'reporter_name', 'reason', 'description'];
const ID_COLUMNS = ['entity_id', 'owner_id', 'channel_id', 'reporter_id'];
const HISTORY_TEXT_COLUMNS = ['moderator_name', 'moderator_notes'];

/**
 * The shared filters on alias `a` (q, entityType, reason, from, to); History
 * adds moderator name and notes to the text search.
 */
export function sharedWhere(f: ReportQueueFilters, a: string, opts: { history?: boolean } = {}): Where {
  const sql: string[] = [];
  const binds: unknown[] = [];
  if (f.q) {
    const text = [...TEXT_COLUMNS, ...(opts.history ? HISTORY_TEXT_COLUMNS : [])];
    const like = likeTerm(f.q);
    const parts = [
      ...text.map((col) => {
        binds.push(like);
        return `lower(${a}.${col}) LIKE ? ESCAPE '\\'`;
      }),
      ...ID_COLUMNS.map((col) => {
        binds.push(f.q!.trim());
        return `${a}.${col} = ?`;
      }),
    ];
    sql.push(`(${parts.join(' OR ')})`);
  }
  if (f.entityType) {
    sql.push(`${a}.entity_type = ?`);
    binds.push(f.entityType);
  }
  if (f.reason) {
    sql.push(`${a}.reason = ?`);
    binds.push(f.reason);
  }
  if (f.from) {
    sql.push(`${a}.created_at >= ?`);
    binds.push(f.from);
  }
  if (f.to) {
    sql.push(`${a}.created_at < ?`);
    binds.push(endOf(f.to));
  }
  return { sql, binds };
}

const QUEUE_ORDER: Record<string, string> = {
  oldest: 'first_reported_at ASC, entity_type, entity_id',
  newest: 'last_reported_at DESC, entity_type, entity_id',
  most_reports: 'report_count DESC, first_reported_at ASC, entity_type, entity_id',
};

const HISTORY_ORDER: Record<string, string> = {
  newest: 'r.resolved_at DESC, r.id',
  oldest: 'r.resolved_at ASC, r.id',
};

/** Open groups matching the filters: the WHERE that selects their open reports. */
export function groupWhere(f: ReportQueueFilters): Where {
  const inner = sharedWhere(f, 'm');
  const sql = [`r.status IN ${OPEN}`];
  const binds: unknown[] = [];
  if (f.entityType) {
    sql.push('r.entity_type = ?');
    binds.push(f.entityType);
  }
  if (inner.sql.length) {
    sql.push(`(r.entity_type, r.entity_id) IN (SELECT m.entity_type, m.entity_id FROM reports m WHERE m.status IN ${OPEN} AND ${inner.sql.join(' AND ')})`);
    binds.push(...inner.binds);
  }
  return { sql, binds };
}

/** Action needed: one page of groups. */
export function buildQueueSql(query: ReportQueueQuery & { page: number; pageSize: number }) {
  const where = groupWhere(query);
  const whereSql = where.sql.join(' AND ');
  const grouped = `
    SELECT r.entity_type, r.entity_id, COUNT(*) AS report_count, MIN(r.created_at) AS first_reported_at, MAX(r.created_at) AS last_reported_at,
           MAX(r.entity_title) AS entity_title, MAX(r.entity_parent_id) AS entity_parent_id, MAX(r.channel_id) AS channel_id,
           MAX(r.channel_name) AS channel_name, MAX(r.owner_id) AS owner_id, MAX(r.owner_name) AS owner_name
    FROM reports r WHERE ${whereSql} GROUP BY r.entity_type, r.entity_id`;
  return {
    page: {
      sql: `SELECT * FROM (${grouped}) ORDER BY ${QUEUE_ORDER[query.sort ?? 'oldest'] ?? QUEUE_ORDER.oldest} LIMIT ? OFFSET ?`,
      binds: [...where.binds, query.pageSize, (query.page - 1) * query.pageSize],
    },
    count: {
      sql: `SELECT COUNT(*) AS groups, COALESCE(SUM(report_count), 0) AS reports FROM (${grouped})`,
      binds: where.binds,
    },
  };
}

/** History: one page of closed reports. */
export function buildHistorySql(query: ReportHistoryQuery & { page: number; pageSize: number }) {
  const shared = sharedWhere(query, 'r', { history: true });
  const sql = [`r.status IN ${CLOSED}`, ...shared.sql];
  const binds = [...shared.binds];
  if (query.action) {
    sql.push('r.action = ?');
    binds.push(query.action);
  }
  if (query.moderatorId) {
    sql.push('r.moderator_id = ?');
    binds.push(query.moderatorId);
  }
  const whereSql = sql.join(' AND ');
  return {
    page: {
      sql: `SELECT r.* FROM reports r WHERE ${whereSql} ORDER BY ${HISTORY_ORDER[query.sort ?? 'newest'] ?? HISTORY_ORDER.newest} LIMIT ? OFFSET ?`,
      binds: [...binds, query.pageSize, (query.page - 1) * query.pageSize],
    },
    count: { sql: `SELECT COUNT(*) AS n FROM reports r WHERE ${whereSql}`, binds },
  };
}

/** Tab badges under the shared filters. */
export async function tabCounts(db: D1Database, f: ReportQueueFilters): Promise<ReportQueueCounts> {
  const queue = buildQueueSql({ ...f, page: 1, pageSize: 1 }).count;
  const history = sharedWhere(f, 'r', { history: true });
  const [open, closed] = await Promise.all([
    db.prepare(queue.sql).bind(...queue.binds).first<{ groups: number; reports: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM reports r WHERE ${[`r.status IN ${CLOSED}`, ...history.sql].join(' AND ')}`)
      .bind(...history.binds)
      .first<{ n: number }>(),
  ]);
  return { actionNeeded: Number(open?.groups) || 0, openReports: Number(open?.reports) || 0, history: Number(closed?.n) || 0 };
}

// ---------------------------------------------------------------------------
// Rows → response
// ---------------------------------------------------------------------------

export interface ItemCopy {
  entity_type: ReportableEntityType;
  entity_id: string;
  entity_title: string | null;
  entity_parent_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

export interface ReportRow extends ItemCopy {
  id: string;
  reporter_id: string;
  reporter_name: string | null;
  reason: ReportReason;
  description: string | null;
  status: string;
  moderator_id: string | null;
  moderator_name: string | null;
  action: ModerationAction | null;
  moderator_notes: string | null;
  banned_user_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** The item from the live lookup when it has it, otherwise from the copies on the reports. */
export function itemSummary(copy: ItemCopy, lookup: Lookup | null): ReportedItemSummary {
  const live = lookup?.items.get(itemKey(copy.entity_type, copy.entity_id));
  if (live?.found) {
    const owner = live.ownerId ? lookup!.users.get(live.ownerId) : undefined;
    return {
      type: copy.entity_type,
      id: copy.entity_id,
      title: live.title,
      parentId: live.parentId,
      channel: live.channelId ? { id: live.channelId, name: live.channelName } : null,
      owner: live.ownerId ? { id: live.ownerId, name: owner?.found ? owner.displayName || owner.userName : null, isBanned: owner ? owner.isBanned : null } : null,
      found: true,
      isHidden: live.isHidden,
      isDeleted: live.isDeleted,
    };
  }
  const owner = copy.owner_id ? lookup?.users.get(copy.owner_id) : undefined;
  return {
    type: copy.entity_type,
    id: copy.entity_id,
    title: copy.entity_title,
    parentId: copy.entity_parent_id,
    channel: copy.channel_id ? { id: copy.channel_id, name: copy.channel_name } : null,
    owner: copy.owner_id ? { id: copy.owner_id, name: owner?.found ? owner.displayName || owner.userName : copy.owner_name, isBanned: owner ? owner.isBanned : null } : null,
    found: live ? false : null,
    isHidden: null,
    isDeleted: null,
  };
}

const personName = (lookup: Lookup | null, id: string, copy: string | null): string | null => {
  const user = lookup?.users.get(id);
  if (user) return user.found ? user.displayName || user.userName : null;
  return copy;
};

function excerpt(row: Pick<ReportRow, 'id' | 'reason' | 'description' | 'reporter_id' | 'reporter_name' | 'created_at'>, lookup: Lookup | null): ReportExcerpt {
  return {
    reportId: row.id,
    reason: row.reason,
    description: row.description,
    reporter: { id: row.reporter_id, name: personName(lookup, row.reporter_id, row.reporter_name) },
    createdAt: row.created_at,
  };
}

export function historyRow(row: ReportRow, lookup: Lookup | null): ReportHistoryRow {
  return {
    reportId: row.id,
    key: itemKey(row.entity_type, row.entity_id),
    item: itemSummary(row, lookup),
    reason: row.reason,
    description: row.description,
    reporter: { id: row.reporter_id, name: personName(lookup, row.reporter_id, row.reporter_name) },
    status: row.status === 'dismissed' ? 'dismissed' : 'resolved',
    action: row.action,
    notes: row.moderator_notes,
    moderator: row.moderator_id ? { id: row.moderator_id, name: personName(lookup, row.moderator_id, row.moderator_name) } : null,
    bannedUserId: row.banned_user_id,
    reportedAt: row.created_at,
    closedAt: row.resolved_at,
  };
}

const AI_SUBJECT: Partial<Record<ReportableEntityType, string>> = { video: 'video', livestream: 'video', comment: 'comment', post: 'post' };

interface GroupRow extends ItemCopy {
  report_count: number;
  first_reported_at: string;
  last_reported_at: string;
}

/** Reasons, newest reports and AI signals for a page of groups (three queries for the whole page). */
export async function groupDetails(db: D1Database, groups: ItemCopy[]) {
  const ids = JSON.stringify([...new Set(groups.map((g) => g.entity_id))]);
  const wanted = new Set(groups.map((g) => itemKey(g.entity_type, g.entity_id)));
  const [reasons, latest, signals] = await Promise.all([
    db
      .prepare(`SELECT entity_type, entity_id, reason, COUNT(*) AS n FROM reports WHERE status IN ${OPEN} AND entity_id IN (SELECT value FROM json_each(?)) GROUP BY entity_type, entity_id, reason`)
      .bind(ids)
      .all<{ entity_type: string; entity_id: string; reason: ReportReason; n: number }>(),
    db
      .prepare(
        `SELECT * FROM (
           SELECT id, entity_type, entity_id, reporter_id, reporter_name, reason, description, created_at,
                  ROW_NUMBER() OVER (PARTITION BY entity_type, entity_id ORDER BY created_at DESC, id) AS rn
           FROM reports WHERE status IN ${OPEN} AND entity_id IN (SELECT value FROM json_each(?))
         ) WHERE rn <= ? ORDER BY created_at DESC`,
      )
      .bind(ids, REPORT_GROUP_LATEST)
      .all<ReportRow>(),
    db
      .prepare(
        `SELECT * FROM (
           SELECT id, subject_type, subject_id, decision, top_category, top_score, review_status, created_at,
                  ROW_NUMBER() OVER (PARTITION BY subject_type, subject_id ORDER BY created_at DESC, id) AS rn
           FROM moderation_signals WHERE subject_id IN (SELECT value FROM json_each(?))
         ) WHERE rn = 1`,
      )
      .bind(ids)
      .all<{ id: string; subject_type: string; subject_id: string; decision: ReportAiSummary['decision']; top_category: string | null; top_score: number | null; review_status: ReportAiSummary['reviewStatus']; created_at: string }>()
      .catch((error) => {
        logger.warn('[ReportQueue] AI signals could not be read', { error: String(error) });
        return { results: [] };
      }),
  ]);
  const reasonMap = new Map<string, Partial<Record<ReportReason, number>>>();
  for (const r of reasons.results ?? []) {
    const key = itemKey(r.entity_type, r.entity_id);
    if (!wanted.has(key)) continue;
    const entry = reasonMap.get(key) ?? {};
    entry[r.reason] = Number(r.n);
    reasonMap.set(key, entry);
  }
  const latestMap = new Map<string, ReportRow[]>();
  for (const r of latest.results ?? []) {
    const key = itemKey(r.entity_type, r.entity_id);
    if (!wanted.has(key)) continue;
    latestMap.set(key, [...(latestMap.get(key) ?? []), r]);
  }
  const signalMap = new Map<string, ReportAiSummary>();
  for (const s of signals.results ?? []) {
    signalMap.set(`${s.subject_type}:${s.subject_id}`, {
      signalId: s.id,
      decision: s.decision,
      topCategory: s.top_category,
      topScore: s.top_score === null ? null : Number(s.top_score),
      reviewStatus: s.review_status,
      createdAt: s.created_at,
    });
  }
  return { reasonMap, latestMap, signalMap };
}

/** Builds the page's groups, with one live lookup for the items, owners and reporters shown. */
export async function buildGroups(env: MetaEnv, rows: GroupRow[]): Promise<{ groups: ReportGroup[]; lookup: Lookup | null }> {
  if (rows.length === 0) return { groups: [], lookup: null };
  const { reasonMap, latestMap, signalMap } = await groupDetails(env.REPORTS_DB, rows);
  const reporters = [...latestMap.values()].flat().map((r) => r.reporter_id);
  const lookup = await lookupMany(env, rows.map((r) => ({ type: r.entity_type, id: r.entity_id })), [...reporters, ...rows.map((r) => r.owner_id ?? '')]);
  if (lookup) await storeItemCopies(env.REPORTS_DB, rows, lookup);
  const groups = rows.map((row): ReportGroup => {
    const key = itemKey(row.entity_type, row.entity_id);
    const subject = AI_SUBJECT[row.entity_type];
    return {
      key,
      item: itemSummary(row, lookup),
      reportCount: Number(row.report_count),
      reasons: reasonMap.get(key) ?? {},
      firstReportedAt: row.first_reported_at,
      lastReportedAt: row.last_reported_at,
      latest: (latestMap.get(key) ?? []).map((r) => excerpt(r, lookup)),
      ai: subject ? signalMap.get(`${subject}:${row.entity_id}`) ?? null : null,
    };
  });
  return { groups, lookup };
}

/** Keeps the search copies of shown items current (renamed titles, channels, owners). */
async function storeItemCopies(db: D1Database, rows: ItemCopy[], lookup: Lookup): Promise<void> {
  const statements = rows.flatMap((row) => {
    const live = lookup.items.get(itemKey(row.entity_type, row.entity_id));
    if (!live?.found) return [];
    const owner = live.ownerId ? lookup.users.get(live.ownerId) : undefined;
    const ownerName = owner?.found ? owner.displayName || owner.userName : null;
    if (live.title === row.entity_title && live.channelName === row.channel_name && live.ownerId === row.owner_id && ownerName === row.owner_name && live.parentId === row.entity_parent_id) return [];
    return [
      db
        .prepare('UPDATE reports SET entity_title = ?, entity_parent_id = ?, channel_id = ?, channel_name = ?, owner_id = ?, owner_name = ? WHERE entity_type = ? AND entity_id = ?')
        .bind(live.title, live.parentId, live.channelId, live.channelName, live.ownerId, ownerName, row.entity_type, row.entity_id),
    ];
  });
  if (statements.length === 0) return;
  await db.batch(statements).catch((error) => logger.warn('[ReportQueue] Could not store refreshed item copies', { items: statements.length, error: String(error) }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listQueue(env: MetaEnv, query: ReturnType<typeof parseQueueQuery>) {
  const db = env.REPORTS_DB;
  const sql = buildQueueSql(query);
  const [{ results = [] }, counts] = await Promise.all([db.prepare(sql.page.sql).bind(...sql.page.binds).all<GroupRow>(), tabCounts(db, query)]);
  const { groups } = await buildGroups(env, results);
  return { items: groups, total: counts.actionNeeded, page: query.page, pageSize: query.pageSize, counts };
}

export async function listHistory(env: MetaEnv, query: ReturnType<typeof parseHistoryQuery>) {
  const db = env.REPORTS_DB;
  const sql = buildHistorySql(query);
  const [{ results = [] }, total, counts] = await Promise.all([
    db.prepare(sql.page.sql).bind(...sql.page.binds).all<ReportRow>(),
    db.prepare(sql.count.sql).bind(...sql.count.binds).first<{ n: number }>(),
    tabCounts(db, query),
  ]);
  const lookup = results.length
    ? await lookupMany(env, results.map((r) => ({ type: r.entity_type, id: r.entity_id })), results.flatMap((r) => [r.reporter_id, r.moderator_id ?? '', r.owner_id ?? '']))
    : null;
  return { items: results.map((r) => historyRow(r, lookup)), total: Number(total?.n) || 0, page: query.page, pageSize: query.pageSize, counts };
}

/** One item: its open group (if any), every open report and its closed ones. */
export async function readItem(env: MetaEnv, type: ReportableEntityType, id: string): Promise<ReportItemResult> {
  const db = env.REPORTS_DB;
  const [{ results: groupRows = [] }, { results: open = [] }, { results: closed = [] }] = await Promise.all([
    db
      .prepare(
        `SELECT r.entity_type, r.entity_id, COUNT(*) AS report_count, MIN(r.created_at) AS first_reported_at, MAX(r.created_at) AS last_reported_at,
                MAX(r.entity_title) AS entity_title, MAX(r.entity_parent_id) AS entity_parent_id, MAX(r.channel_id) AS channel_id,
                MAX(r.channel_name) AS channel_name, MAX(r.owner_id) AS owner_id, MAX(r.owner_name) AS owner_name
         FROM reports r WHERE r.entity_type = ? AND r.entity_id = ? AND r.status IN ${OPEN} GROUP BY r.entity_type, r.entity_id`,
      )
      .bind(type, id)
      .all<GroupRow>(),
    db.prepare(`SELECT * FROM reports WHERE entity_type = ? AND entity_id = ? AND status IN ${OPEN} ORDER BY created_at ASC, id LIMIT 200`).bind(type, id).all<ReportRow>(),
    db.prepare(`SELECT * FROM reports WHERE entity_type = ? AND entity_id = ? AND status IN ${CLOSED} ORDER BY resolved_at DESC, id LIMIT 50`).bind(type, id).all<ReportRow>(),
  ]);
  const { groups, lookup: groupLookup } = await buildGroups(env, groupRows);
  const people = [...open, ...closed].flatMap((r) => [r.reporter_id, r.moderator_id ?? '']);
  const anyRow = open[0] ?? closed[0];
  const lookup = await lookupMany(env, [{ type, id }], [...people, anyRow?.owner_id ?? '']) ?? groupLookup;
  const copy: ItemCopy = anyRow ?? { entity_type: type, entity_id: id, entity_title: null, entity_parent_id: null, channel_id: null, channel_name: null, owner_id: null, owner_name: null };
  return {
    group: groups[0] ?? null,
    item: itemSummary(copy, lookup),
    open: open.map((r) => excerpt(r, lookup)),
    history: closed.map((r) => historyRow(r, lookup)),
  };
}

/** Open reports of one item, for an item decision. */
export async function openReportsOf(db: D1Database, type: ReportableEntityType, id: string) {
  const { results = [] } = await db
    .prepare(`SELECT id, entity_type, entity_id, status FROM reports WHERE entity_type = ? AND entity_id = ? AND status IN ${OPEN} ORDER BY created_at ASC LIMIT 500`)
    .bind(type, id)
    .all<{ id: string; entity_type: ReportableEntityType; entity_id: string; status: 'pending' | 'reviewing' }>();
  return results;
}

/** Autocomplete: items whose reports match (open items first, then closed ones), as `${type}:${id}` keys. */
export async function suggestItems(db: D1Database, q: string, limit: number) {
  const where = sharedWhere({ q }, 'r', { history: true });
  const { results = [] } = await db
    .prepare(
      `SELECT r.entity_type, r.entity_id, MAX(r.entity_title) AS entity_title, MAX(r.entity_parent_id) AS entity_parent_id,
              MAX(r.channel_name) AS channel_name, MAX(r.owner_name) AS owner_name,
              SUM(CASE WHEN r.status IN ${OPEN} THEN 1 ELSE 0 END) AS open_count, MAX(r.created_at) AS last_reported_at
       FROM reports r WHERE r.entity_id IN (SELECT DISTINCT m.entity_id FROM reports m WHERE ${where.sql.join(' AND ').replace(/\br\./g, 'm.')})
       GROUP BY r.entity_type, r.entity_id
       ORDER BY open_count > 0 DESC, last_reported_at DESC LIMIT ?`,
    )
    .bind(...where.binds, limit)
    .all<ItemCopy & { open_count: number }>();
  return results;
}

/** One item by key, for the suggestion chip. */
export async function suggestItem(db: D1Database, type: ReportableEntityType, id: string) {
  return db
    .prepare(
      `SELECT r.entity_type, r.entity_id, MAX(r.entity_title) AS entity_title, MAX(r.entity_parent_id) AS entity_parent_id,
              MAX(r.channel_name) AS channel_name, MAX(r.owner_name) AS owner_name,
              SUM(CASE WHEN r.status IN ${OPEN} THEN 1 ELSE 0 END) AS open_count
       FROM reports r WHERE r.entity_type = ? AND r.entity_id = ? GROUP BY r.entity_type, r.entity_id`,
    )
    .bind(type, id)
    .first<ItemCopy & { open_count: number }>();
}

/** Parses a `${type}:${id}` group key. */
export function parseItemKey(key: string): { type: ReportableEntityType; id: string } | null {
  const at = key.indexOf(':');
  if (at <= 0) return null;
  const type = key.slice(0, at);
  const id = key.slice(at + 1);
  if (!id || !(REPORT_ENTITY_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as ReportableEntityType, id };
}
