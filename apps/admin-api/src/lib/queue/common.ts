/**
 * Shared pieces of the admin queues (docs/admin/QUEUES.md): the filters every
 * queue reads, SQL fragment helpers and the page/count query.
 *
 * Each queue builds two WHERE clauses from the same filters, one per tab, and
 * runs the page query and both tab counts in one D1 batch, so the tab badges
 * always agree with the list under the same filters.
 */
import {
  ADMIN_QUEUE_DEFAULT_LIMIT,
  ADMIN_QUEUE_MAX_LIMIT,
  type AdminQueueCounts,
  type AdminQueuePerson,
  type AdminQueueTab,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';

export interface QueueFilters {
  tab: AdminQueueTab;
  q?: string | undefined;
  /** UTC days (YYYY-MM-DD), inclusive */
  from?: string | undefined;
  to?: string | undefined;
  /** User id of who handled it ('me' already resolved) */
  actor?: string | undefined;
  outcome?: string | undefined;
  type?: string | undefined;
  category?: string | undefined;
  /** 'unassigned' or a user id ('me' already resolved) */
  assignee?: string | undefined;
  sort?: string | undefined;
  limit: number;
  offset: number;
}

/** A WHERE clause as a list of conditions (joined with AND) and their bound values. */
export interface Where {
  sql: string[];
  args: unknown[];
}

export const where = (): Where => ({ sql: [], args: [] });

export function add(w: Where, sql: string, ...args: unknown[]): Where {
  w.sql.push(sql);
  w.args.push(...args);
  return w;
}

export const clauseOf = (w: Where) => (w.sql.length ? `WHERE ${w.sql.join(' AND ')}` : '');

/** Start and end of a UTC day range on an ISO timestamp column. */
export function addDateRange(w: Where, column: string, from?: string, to?: string): Where {
  if (from) add(w, `${column} >= ?`, `${from}T00:00:00.000Z`);
  if (to) add(w, `${column} <= ?`, `${to}T23:59:59.999Z`);
  return w;
}

/** `%term%` with the LIKE wildcards in the term escaped (use with ESCAPE '\'). */
export function likePattern(q: string): string {
  return `%${q.trim().toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** 'me' → the viewer; anything else as given. */
export const resolveMe = (value: string | undefined, viewerId: string): string | undefined => (value === 'me' ? viewerId : value || undefined);

export function clampPage(limit?: number, offset?: number): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Math.floor(Number(limit) || ADMIN_QUEUE_DEFAULT_LIMIT), 1), ADMIN_QUEUE_MAX_LIMIT),
    offset: Math.max(Math.floor(Number(offset) || 0), 0),
  };
}

/**
 * One D1 batch: the page of the requested tab and the count of both tabs.
 * `select` is the SELECT … FROM … part; `order` the ORDER BY expression.
 */
export async function pageAndCounts<Row>(
  db: D1Database,
  q: { select: string; from: string; order: string; tab: AdminQueueTab; action: Where; history: Where; limit: number; offset: number },
): Promise<{ rows: Row[]; counts: AdminQueueCounts }> {
  const current = q.tab === 'action' ? q.action : q.history;
  const [rows, action, history] = await db.batch([
    db.prepare(`${q.select} FROM ${q.from} ${clauseOf(current)} ORDER BY ${q.order} LIMIT ? OFFSET ?`).bind(...current.args, q.limit, q.offset),
    db.prepare(`SELECT COUNT(*) AS n FROM ${q.from} ${clauseOf(q.action)}`).bind(...q.action.args),
    db.prepare(`SELECT COUNT(*) AS n FROM ${q.from} ${clauseOf(q.history)}`).bind(...q.history.args),
  ]);
  const n = (r: unknown) => Number(((r as { results?: { n?: number }[] }).results?.[0]?.n) ?? 0);
  return { rows: ((rows as { results?: Row[] }).results ?? []) as Row[], counts: { action: n(action), history: n(history) } };
}

/** A person from an id and what is known of them: the profile name first, then the email. */
export function personOf(id: string | null | undefined, names: Map<string, string>, email?: string | null): AdminQueuePerson | null {
  if (!id && !email) return null;
  return { id: id ?? null, name: (id ? names.get(id) : undefined) ?? email ?? null };
}

/** One line of at most `max` characters. */
export function clip(text: string | null | undefined, max = 140): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
