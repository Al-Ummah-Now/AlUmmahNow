/**
 * The query string every queue endpoint accepts (docs/admin/QUEUES.md), as a
 * zod object each queue extends with its own sorts, outcomes and filters.
 */
import { z } from 'zod';
import { ADMIN_QUEUE_DEFAULT_LIMIT, ADMIN_QUEUE_MAX_LIMIT, ADMIN_QUEUE_MAX_QUERY, ADMIN_QUEUE_TABS } from '@al-ummah/shared-types';
import { resolveMe, type QueueFilters } from './common';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERSON = z.string().regex(/^(me|[A-Za-z0-9_-]{1,200})$/);

export function queueQuery<S extends readonly [string, ...string[]], O extends readonly [string, ...string[]]>(sorts: S, outcomes: O) {
  return z.object({
    q: z.string().trim().max(ADMIN_QUEUE_MAX_QUERY).optional(),
    tab: z.enum(ADMIN_QUEUE_TABS).default('action'),
    from: z.string().regex(DAY).optional(),
    to: z.string().regex(DAY).optional(),
    actor: PERSON.optional(),
    outcome: z.enum(outcomes as unknown as [string, ...string[]]).optional(),
    sort: z.enum(sorts as unknown as [string, ...string[]]).optional(),
    limit: z.coerce.number().int().min(1).max(ADMIN_QUEUE_MAX_LIMIT).default(ADMIN_QUEUE_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  });
}

/** `assignee`: me, unassigned or a user id. */
export const assigneeParam = z.union([z.literal('unassigned'), PERSON]).optional();

/** Validated query → the filters the queue libraries read ('me' resolved to the viewer). */
export function toFilters(
  query: { q?: string | undefined; tab: 'action' | 'history'; from?: string | undefined; to?: string | undefined; actor?: string | undefined; outcome?: string | undefined; sort?: string | undefined; limit: number; offset: number; type?: string | undefined; category?: string | undefined; assignee?: string | undefined },
  viewerId: string,
): QueueFilters {
  return {
    tab: query.tab,
    q: query.q || undefined,
    from: query.from,
    to: query.to,
    actor: resolveMe(query.actor, viewerId),
    outcome: query.outcome,
    type: query.type,
    category: query.category,
    assignee: resolveMe(query.assignee, viewerId),
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
  };
}
