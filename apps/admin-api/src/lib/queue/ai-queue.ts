/**
 * AI moderation flags as a queue (docs/admin/QUEUES.md).
 *
 * Action needed: signals awaiting review (review_status 'pending') that no
 * reviewer has acted on. History: signals a reviewer agreed or disagreed
 * with, hid or restored (handled_* columns, migration 0019), with who and when.
 */
import {
  LLAMA_GUARD_CATEGORIES,
  MODERATION_EXTENSION_CATEGORIES,
  type AdminQueueLink,
  type AdminQueuePage,
  type AiQueueItem,
  type AiQueueOutcome,
  type ModerationDecision,
  type ModerationSubjectType,
  type ModerationSurface,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';
import { add, addDateRange, pageAndCounts, personOf, where, type QueueFilters, type Where } from './common';
import { matchIds, resolveNames, type IdMatches } from './names';

/** Category codes whose code or name contains the search ("hate" → S10, "scam" → charity_scam). */
export function categoriesMatching(q: string): string[] {
  const term = q.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!term) return [];
  const named: [string, string][] = [
    ...Object.entries(LLAMA_GUARD_CATEGORIES),
    ...MODERATION_EXTENSION_CATEGORIES.map((c): [string, string] => [c, c]),
  ];
  return named.filter(([code, name]) => code.toLowerCase() === term || name.includes(term)).map(([code]) => code);
}

/** Ids from the search index that the search matched (names, titles, text) plus matching categories. */
export interface AiSearchMatches {
  ids: IdMatches;
  categories: string[];
}

const IN_JSON = (column: string) => `${column} IN (SELECT value FROM json_each(?))`;

/** The search condition on signals (alias s). */
export function aiSearchCondition(q: string, m: AiSearchMatches): { sql: string; args: unknown[] } {
  const term = q.trim();
  const parts = ['s.id = ?', 's.subject_id = ?', 's.author_id = ?', 's.channel_id = ?'];
  const args: unknown[] = [term, term, term, term];
  const subjects = [...m.ids.videos, ...m.ids.comments, ...m.ids.posts];
  if (subjects.length) {
    parts.push(IN_JSON('s.subject_id'));
    args.push(JSON.stringify(subjects));
  }
  if (m.ids.posts.length) {
    // A comment on a matching post
    parts.push(`(s.subject_type = 'post_comment' AND ${IN_JSON('s.parent_id')})`);
    args.push(JSON.stringify(m.ids.posts));
  }
  if (m.ids.videos.length) {
    // A comment on a matching video
    parts.push(`(s.subject_type = 'comment' AND ${IN_JSON('s.parent_id')})`);
    args.push(JSON.stringify(m.ids.videos));
  }
  if (m.ids.profiles.length) {
    parts.push(IN_JSON('s.author_id'));
    args.push(JSON.stringify(m.ids.profiles));
  }
  if (m.ids.channels.length) {
    parts.push(IN_JSON('s.channel_id'));
    args.push(JSON.stringify(m.ids.channels));
  }
  if (m.categories.length) {
    parts.push(`s.top_category IN (${m.categories.map(() => '?').join(', ')})`);
    args.push(...m.categories);
  }
  return { sql: `(${parts.join(' OR ')})`, args };
}

/** WHERE of each tab under the same filters. */
export function aiQueueWhere(f: QueueFilters, matches?: AiSearchMatches): { action: Where; history: Where } {
  const base = (w: Where) => {
    if (f.type) add(w, 's.surface = ?', f.type);
    if (f.category) add(w, 's.top_category = ?', f.category);
    if (f.q && f.q.trim()) {
      const search = aiSearchCondition(f.q, matches ?? { ids: { profiles: [], channels: [], videos: [], comments: [], posts: [] }, categories: [] });
      add(w, search.sql, ...search.args);
    }
    return w;
  };
  const action = add(base(where()), "s.review_status = 'pending' AND s.handled_at IS NULL");
  addDateRange(action, 's.created_at', f.from, f.to);
  const history = add(base(where()), 's.handled_at IS NOT NULL');
  addDateRange(history, 's.handled_at', f.from, f.to);
  if (f.actor) add(history, 's.handled_by_id = ?', f.actor);
  if (f.outcome) add(history, 's.handled_action = ?', f.outcome);
  return { action, history };
}

export function aiQueueOrder(f: QueueFilters): string {
  const date = f.tab === 'action' ? 's.created_at' : 's.handled_at';
  const sort = f.sort ?? (f.tab === 'action' ? 'oldest' : 'newest');
  if (sort === 'priority') return `s.priority DESC, ${date} ASC, s.id`;
  return `${date} ${sort === 'newest' ? 'DESC' : 'ASC'}, s.id`;
}

interface Row {
  id: string;
  subject_type: ModerationSubjectType;
  subject_id: string;
  parent_id: string | null;
  surface: ModerationSurface;
  author_id: string | null;
  channel_id: string | null;
  language: string | null;
  top_category: string | null;
  top_score: number | null;
  decision: ModerationDecision;
  priority: number;
  created_at: string;
  handled_action: AiQueueOutcome | null;
  handled_by_id: string | null;
  handled_by_email: string | null;
  handled_at: string | null;
}

/** Where a signal's row leads in the admin. */
export function aiLink(r: Pick<Row, 'subject_type' | 'subject_id' | 'parent_id' | 'channel_id'>): AdminQueueLink | null {
  switch (r.subject_type) {
    case 'video':
      return { kind: 'video', id: r.subject_id };
    case 'comment':
      return { kind: 'comment', id: r.subject_id, parentId: r.parent_id };
    case 'post':
      return { kind: 'post', id: r.subject_id, parentId: r.channel_id };
    case 'post_comment':
      // Post comments have no admin page: the post they are on
      return r.parent_id ? { kind: 'post', id: r.parent_id, parentId: r.channel_id } : null;
    default:
      return null;
  }
}

export async function listAiQueue(db: D1Database, search: D1Database | undefined, f: QueueFilters): Promise<AdminQueuePage<AiQueueItem>> {
  const matches = f.q && f.q.trim() ? { ids: await matchIds(search, f.q), categories: categoriesMatching(f.q) } : undefined;
  const { action, history } = aiQueueWhere(f, matches);
  const { rows, counts } = await pageAndCounts<Row>(db, {
    select:
      'SELECT s.id, s.subject_type, s.subject_id, s.parent_id, s.surface, s.author_id, s.channel_id, s.language, s.top_category, s.top_score, s.decision, s.priority, s.created_at, s.handled_action, s.handled_by_id, s.handled_by_email, s.handled_at',
    from: 'moderation_signals s',
    order: aiQueueOrder(f),
    tab: f.tab,
    action,
    history,
    limit: f.limit,
    offset: f.offset,
  });

  const names = await resolveNames(search, {
    profiles: rows.flatMap((r) => [r.author_id, r.handled_by_id]),
    channels: rows.map((r) => r.channel_id),
    videos: rows.filter((r) => r.subject_type === 'video').map((r) => r.subject_id),
    comments: rows.filter((r) => r.subject_type === 'comment').map((r) => r.subject_id),
    posts: rows.filter((r) => r.subject_type === 'post').map((r) => r.subject_id),
  });
  const subjectLabel = (r: Row): string | null => {
    if (r.subject_type === 'video') return names.videos.get(r.subject_id) ?? null;
    if (r.subject_type === 'comment') return names.comments.get(r.subject_id) ?? null;
    if (r.subject_type === 'post') return names.posts.get(r.subject_id) ?? null;
    return null;
  };

  return {
    tab: f.tab,
    items: rows.map((r) => ({
      id: r.id,
      surface: r.surface,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      subjectLabel: subjectLabel(r),
      link: aiLink(r),
      author: personOf(r.author_id, names.profiles),
      channel: r.channel_id ? { id: r.channel_id, name: names.channels.get(r.channel_id) ?? null } : null,
      category: r.top_category,
      score: r.top_score,
      decision: r.decision,
      priority: r.priority,
      language: r.language,
      createdAt: r.created_at,
      handled: r.handled_at && r.handled_action ? { outcome: r.handled_action, by: personOf(r.handled_by_id, names.profiles, r.handled_by_email), at: r.handled_at } : null,
    })),
    total: counts[f.tab],
    counts,
    limit: f.limit,
    offset: f.offset,
  };
}
