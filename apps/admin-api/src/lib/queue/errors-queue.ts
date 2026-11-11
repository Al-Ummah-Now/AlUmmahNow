/**
 * Errors as a queue (docs/admin/QUEUES.md).
 *
 * Action needed: groups still new or acknowledged, and any group with an open
 * needs-action item (whatever its status). History: resolved and ignored
 * groups with nothing open, with who did it and when (handled_* columns,
 * migration 0019). Test groups (release E2E) are left out unless asked for or
 * the search is a reference.
 */
import type { AdminQueuePage, ErrorQueueItem, ErrorQueueOutcome, ErrorStatus } from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import { errorSearchCondition } from '../errors-store';
import { add, pageAndCounts, personOf, where, type QueueFilters, type Where } from './common';
import { resolveNames } from './names';

export interface ErrorQueueFilters extends QueueFilters {
  app?: string | undefined;
  environment?: string | undefined;
  includeTest?: boolean | undefined;
}

const OPEN_ACTIONS = "EXISTS (SELECT 1 FROM error_actions a WHERE a.group_id = g.id AND a.status IN ('open', 'retrying'))";

export function errorQueueWhere(f: ErrorQueueFilters): { action: Where; history: Where } {
  const base = (w: Where) => {
    if (f.type) add(w, 'g.kind = ?', f.type);
    if (f.app) add(w, 'g.app = ?', f.app);
    if (f.environment) add(w, 'g.environment = ?', f.environment);
    if (!f.includeTest) add(w, 'g.test = 0');
    if (f.assignee === 'unassigned') add(w, 'g.assignee_id IS NULL');
    else if (f.assignee) add(w, 'g.assignee_id = ?', f.assignee);
    if (f.q && f.q.trim()) {
      const search = errorSearchCondition(f.q, true);
      add(w, search.sql, ...search.args);
    }
    return w;
  };
  const action = add(base(where()), `(g.status IN ('new', 'acknowledged') OR ${OPEN_ACTIONS})`);
  // A group "arrives" with every occurrence: seen during the range (like the Errors list)
  if (f.from) add(action, 'g.last_seen >= ?', `${f.from}T00:00:00.000Z`);
  if (f.to) add(action, 'g.first_seen <= ?', `${f.to}T23:59:59.999Z`);
  const history = add(base(where()), `g.status IN ('resolved', 'ignored') AND NOT ${OPEN_ACTIONS}`);
  if (f.from) add(history, 'g.handled_at >= ?', `${f.from}T00:00:00.000Z`);
  if (f.to) add(history, 'g.handled_at <= ?', `${f.to}T23:59:59.999Z`);
  if (f.actor) add(history, 'g.handled_by_id = ?', f.actor);
  if (f.outcome) add(history, 'g.status = ?', f.outcome);
  return { action, history };
}

export function errorQueueOrder(f: QueueFilters): string {
  const sort = f.sort ?? (f.tab === 'action' ? 'oldest' : 'newest');
  if (sort === 'count') return 'g.occurrences DESC, g.last_seen DESC, g.id';
  if (sort === 'users') return 'g.users DESC, g.last_seen DESC, g.id';
  const date = f.tab === 'action' ? 'g.first_seen' : 'g.handled_at';
  return `${date} ${sort === 'newest' ? 'DESC' : 'ASC'}, g.id`;
}

interface Row {
  id: string;
  app: string;
  environment: string;
  kind: string;
  name: string | null;
  message: string;
  route: string | null;
  status: ErrorStatus;
  occurrences: number;
  users: number;
  open_actions: number;
  first_seen: string;
  last_seen: string;
  assignee_id: string | null;
  assignee_email: string | null;
  handled_by_id: string | null;
  handled_by_email: string | null;
  handled_at: string | null;
}

export async function listErrorQueue(db: D1Database, search: D1Database | undefined, f: ErrorQueueFilters): Promise<AdminQueuePage<ErrorQueueItem>> {
  const { action, history } = errorQueueWhere(f);
  const { rows, counts } = await pageAndCounts<Row>(db, {
    select: `SELECT g.id, g.app, g.environment, g.kind, g.name, g.message, g.route, g.status, g.occurrences, g.users,
      (SELECT COUNT(*) FROM error_actions a WHERE a.group_id = g.id AND a.status IN ('open', 'retrying')) AS open_actions,
      g.first_seen, g.last_seen, g.assignee_id, g.assignee_email, g.handled_by_id, g.handled_by_email, g.handled_at`,
    from: 'error_groups g',
    order: errorQueueOrder(f),
    tab: f.tab,
    action,
    history,
    limit: f.limit,
    offset: f.offset,
  });
  const names = await resolveNames(search, { profiles: rows.flatMap((r) => [r.assignee_id, r.handled_by_id]) });
  const handled = (r: Row): ErrorQueueItem['handled'] =>
    r.handled_at && (r.status === 'resolved' || r.status === 'ignored') && Number(r.open_actions) === 0
      ? { outcome: r.status as ErrorQueueOutcome, by: personOf(r.handled_by_id, names.profiles, r.handled_by_email), at: r.handled_at }
      : null;
  return {
    tab: f.tab,
    items: rows.map((r) => ({
      id: r.id,
      app: r.app,
      environment: r.environment,
      kind: r.kind,
      name: r.name,
      message: r.message,
      route: r.route,
      status: r.status,
      occurrences: Number(r.occurrences),
      users: Number(r.users),
      openActions: Number(r.open_actions),
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      assignee: personOf(r.assignee_id, names.profiles, r.assignee_email),
      link: { kind: 'error', id: r.id },
      handled: handled(r),
    })),
    total: counts[f.tab],
    counts,
    limit: f.limit,
    offset: f.offset,
  };
}
