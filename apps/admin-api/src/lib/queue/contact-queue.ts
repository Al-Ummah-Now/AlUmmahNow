/**
 * Contact messages as a queue (docs/admin/QUEUES.md).
 *
 * Action needed: messages still awaiting a reply (new, open) and any message
 * with a delivery that finally failed (send_failed), whatever its status.
 * History: replied, closed and spam messages with nothing failed, with who
 * handled them and when (handled_* columns, migration 0019).
 */
import type { AdminQueuePage, ContactQueueItem, ContactQueueOutcome } from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import type { ContactStatus, ContactTopic } from '../contact';
import { add, addDateRange, clip, likePattern, pageAndCounts, personOf, where, type QueueFilters, type Where } from './common';
import { resolveNames } from './names';

/** The search condition on messages (alias m): sender name and email, message text, topic, exact id. */
export function contactSearchCondition(q: string): { sql: string; args: unknown[] } {
  const term = q.trim();
  const p = likePattern(term);
  return {
    sql: "(lower(m.name) LIKE ? ESCAPE '\\' OR lower(m.email) LIKE ? ESCAPE '\\' OR lower(m.message) LIKE ? ESCAPE '\\' OR m.topic = ? OR m.id = ?)",
    args: [p, p, p, term.toLowerCase(), term],
  };
}

export function contactQueueWhere(f: QueueFilters): { action: Where; history: Where } {
  const base = (w: Where) => {
    add(w, 'm.deleted_at IS NULL');
    if (f.category) add(w, 'm.topic = ?', f.category);
    if (f.assignee === 'unassigned') add(w, 'm.assignee_id IS NULL');
    else if (f.assignee) add(w, 'm.assignee_id = ?', f.assignee);
    if (f.q && f.q.trim()) {
      const search = contactSearchCondition(f.q);
      add(w, search.sql, ...search.args);
    }
    return w;
  };
  const action = add(base(where()), "(m.status IN ('new', 'open') OR m.send_failed_at IS NOT NULL)");
  addDateRange(action, 'm.created_at', f.from, f.to);
  const history = add(base(where()), "m.status IN ('replied', 'closed', 'spam') AND m.send_failed_at IS NULL");
  addDateRange(history, 'm.handled_at', f.from, f.to);
  if (f.actor) add(history, 'm.handled_by_id = ?', f.actor);
  if (f.outcome) add(history, 'm.status = ?', f.outcome);
  return { action, history };
}

export function contactQueueOrder(f: QueueFilters): string {
  const date = f.tab === 'action' ? 'm.created_at' : 'm.handled_at';
  const sort = f.sort ?? (f.tab === 'action' ? 'oldest' : 'newest');
  return `${date} ${sort === 'newest' ? 'DESC' : 'ASC'}, m.id`;
}

interface Row {
  id: string;
  status: ContactStatus;
  topic: ContactTopic;
  name: string;
  email: string;
  message: string;
  locale: 'en' | 'ar';
  assignee_id: string | null;
  assignee_email: string | null;
  send_failed_at: string | null;
  handled_by_id: string | null;
  handled_by_email: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listContactQueue(db: D1Database, search: D1Database | undefined, f: QueueFilters): Promise<AdminQueuePage<ContactQueueItem>> {
  const { action, history } = contactQueueWhere(f);
  const { rows, counts } = await pageAndCounts<Row>(db, {
    select:
      'SELECT m.id, m.status, m.topic, m.name, m.email, substr(m.message, 1, 400) AS message, m.locale, m.assignee_id, m.assignee_email, m.send_failed_at, m.handled_by_id, m.handled_by_email, m.handled_at, m.created_at, m.updated_at',
    from: 'contact_messages m',
    order: contactQueueOrder(f),
    tab: f.tab,
    action,
    history,
    limit: f.limit,
    offset: f.offset,
  });
  const names = await resolveNames(search, { profiles: rows.flatMap((r) => [r.assignee_id, r.handled_by_id]) });
  const handled = (r: Row): ContactQueueItem['handled'] =>
    r.handled_at && (r.status === 'replied' || r.status === 'closed' || r.status === 'spam') && !r.send_failed_at
      ? { outcome: r.status as ContactQueueOutcome, by: personOf(r.handled_by_id, names.profiles, r.handled_by_email), at: r.handled_at }
      : null;
  return {
    tab: f.tab,
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      topic: r.topic,
      name: r.name,
      email: r.email,
      excerpt: clip(r.message, 200) ?? '',
      locale: r.locale,
      sendFailed: !!r.send_failed_at,
      assignee: personOf(r.assignee_id, names.profiles, r.assignee_email),
      link: { kind: 'contact', id: r.id },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      handled: handled(r),
    })),
    total: counts[f.tab],
    counts,
    limit: f.limit,
    offset: f.offset,
  };
}
