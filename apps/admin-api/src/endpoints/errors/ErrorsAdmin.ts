/**
 * Errors page for admin-web (/errors). Every route needs errors:read and
 * changes need errors:manage (lib/roles.ts PERMISSIONS: admins and super
 * admins). Status changes, assignment and notes are recorded in the group's
 * activity log (audit + timeline).
 */
import { z } from 'zod';
import { ERROR_APPS, ERROR_KINDS, ERROR_QUEUE_OUTCOMES, ERROR_QUEUE_SORTS, ERROR_STATUSES, parseErrorRef } from '@al-ummah/shared-types';
import { listErrorQueue } from '../../lib/queue/errors-queue';
import { assigneeParam, queueQuery, toFilters } from '../../lib/queue/schema';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { hasPermission, type Permission } from '../../lib/roles';
import {
  ERROR_SORTS,
  addErrorNote,
  dailyCounts,
  deleteTestGroupByRef,
  errorCounts,
  errorFacets,
  findByRef,
  getErrorGroup,
  hourlyCounts,
  listErrorGroups,
  listGroupActivity,
  listGroupEvents,
  listGroupReleases,
  setErrorAssignee,
  setErrorStatus,
  getActionItem,
  listGroupActions,
  openActionCount,
  recordActionAttempt,
} from '../../lib/errors-store';
import { parseRetry, runRetry } from '../../lib/errors-actions';

const TAGS = ['Errors'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IdParams = z.object({ id: z.string().regex(/^eg_[0-9a-f]{16}$/) });
const NOTE_MAX = 4000;

abstract class ErrorsRoute extends AdminRoute {
  protected deny(c: AppContext, permission: Permission): Response | null {
    if (hasPermission(this.getRoles(c), permission)) return null;
    logger.warn('[Errors] Permission denied', { userId: this.getUserId(c), permission, path: c.req.path });
    return c.json({ success: false, error: `Permission required: ${permission}` }, 403);
  }

  protected actor(c: AppContext) {
    const auth = this.getAuth(c);
    return { id: auth.userId, email: auth.email || null };
  }
}

export class ErrorGroupList extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'List error groups',
    description:
      'Filters: app, environment, release, status, seen in a UTC day range, search (message, culprit, route, reference ERR-XXXX-XXXX, request id), assignee. Sort by last seen, count, users or first seen. Each group carries 14 daily counts for a sparkline. Needs errors:read.',
    request: {
      query: z.object({
        app: z.enum(ERROR_APPS).optional(),
        environment: z.string().regex(/^[a-z0-9-]{1,30}$/).optional(),
        release: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
        status: z.enum(ERROR_STATUSES).optional(),
        from: z.string().regex(DAY).optional(),
        to: z.string().regex(DAY).optional(),
        q: z.string().trim().max(200).optional(),
        assignee: z.enum(['me', 'unassigned']).optional(),
        sort: z.enum(ERROR_SORTS).default('last_seen'),
        includeTest: z.enum(['0', '1']).optional(),
        needsAction: z.enum(['0', '1']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: { '200': { description: 'Groups and the total matching the filters' }, '403': { description: 'errors:read required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    // A pasted reference finds its group even when typed loosely ("err 3k9f 2b7q")
    const ref = query.q ? parseErrorRef(query.q) : null;
    const result = await listErrorGroups(c.env.REPORTS_DB, {
      ...query,
      q: ref ?? (query.q || undefined),
      includeTest: query.includeTest === '1' || !!ref,
      needsAction: query.needsAction === '1',
      viewerId: this.getUserId(c),
    });
    return { success: true, result: { ...result, limit: query.limit, offset: query.offset } };
  }
}

export class ErrorQueue extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Errors as a queue: Action needed / History (docs/admin/QUEUES.md)',
    description:
      'tab=action: new and acknowledged groups and any group with an open needs-action item, oldest first. tab=history: resolved and ignored groups with who and when, newest first. q searches message, culprit, route, error name, app, reference ERR-XXXX-XXXX and request id; type = error kind, app, environment, outcome = resolved|ignored, actor = who (id or me), assignee = me|unassigned|id. Assignees and actors are names. counts holds both tabs under the same filters. Needs errors:read.',
    request: {
      query: queueQuery(ERROR_QUEUE_SORTS, ERROR_QUEUE_OUTCOMES).extend({
        type: z.enum(ERROR_KINDS).optional(),
        app: z.enum(ERROR_APPS).optional(),
        environment: z.string().regex(/^[a-z0-9-]{1,30}$/).optional(),
        assignee: assigneeParam,
        includeTest: z.enum(['0', '1']).optional(),
      }),
    },
    responses: { '200': { description: 'AdminQueuePage<ErrorQueueItem>' }, '403': { description: 'errors:read required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    // A pasted reference finds its group even when typed loosely, test groups included
    const ref = query.q ? parseErrorRef(query.q) : null;
    const result = await listErrorQueue(c.env.REPORTS_DB, c.env.SEARCH_DB, {
      ...toFilters({ ...query, q: ref ?? query.q }, this.getUserId(c)),
      app: query.app,
      environment: query.environment,
      includeTest: query.includeTest === '1' || !!ref,
    });
    logger.debug('[Errors] Queue listed', { tab: query.tab, total: result.total, searched: !!query.q });
    return { success: true, result };
  }
}

export class ErrorCounts extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Error group counts by status',
    description: 'For the admin nav badge (new). Needs errors:read.',
    responses: { '200': { description: 'Counts per status' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    const [counts, openActions] = await Promise.all([errorCounts(c.env.REPORTS_DB), openActionCount(c.env.REPORTS_DB)]);
    return { success: true, result: { ...counts, openActions } };
  }
}

export class ErrorFacets extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Filter values (apps, environments, releases)',
    responses: { '200': { description: 'Distinct values' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    return { success: true, result: await errorFacets(c.env.REPORTS_DB) };
  }
}

export class ErrorRefLookup extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Find the group of a reference a user quoted',
    request: { params: z.object({ ref: z.string().min(8).max(20) }) },
    responses: { '200': { description: 'Group id and event id' }, '404': { description: 'Unknown reference' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const ref = parseErrorRef(params.ref);
    const hit = ref ? await findByRef(c.env.REPORTS_DB, ref) : null;
    if (!hit) return c.json({ success: false, error: 'Reference not found' }, 404);
    return { success: true, result: { ref, groupId: hit.group_id, eventId: hit.event_id } };
  }
}

export class ErrorGroupGet extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Get an error group',
    description: 'The group, its latest samples (symbolicated stack when the source maps were available), releases, 48 hourly and 30 daily counts and the activity timeline. Needs errors:read.',
    request: { params: IdParams },
    responses: { '200': { description: 'Group detail' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:read');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const group = await getErrorGroup(db, params.id);
    if (!group) return c.json({ success: false, error: 'Error group not found' }, 404);
    const [actions, events, releases, activity, hourly, daily] = await Promise.all([
      listGroupActions(db, params.id),
      listGroupEvents(db, params.id, 20),
      listGroupReleases(db, params.id),
      listGroupActivity(db, params.id),
      hourlyCounts(db, params.id, 48),
      dailyCounts(db, [params.id], 30),
    ]);
    // The retry spec stays server side: the page only needs to know a Retry exists
    const items = actions.map(({ retry_json, ...a }) => ({ ...a, can_retry: !!parseRetry(retry_json) }));
    return { success: true, result: { group, actions: items, events, releases, activity, hourly, daily: daily.get(params.id) ?? [] } };
  }
}

export class ErrorGroupUpdate extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Change an error group status or assignee',
    description:
      'status: acknowledged, resolved (reopens automatically if it recurs in a newer release), ignored or new. assignee: "me" assigns it to the caller, null unassigns. Recorded in the activity log. Needs errors:manage.',
    request: {
      params: IdParams,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ status: z.enum(ERROR_STATUSES).optional(), assignee: z.enum(['me']).nullable().optional() })
              .refine((b) => b.status !== undefined || b.assignee !== undefined, 'Nothing to change'),
          },
        },
      },
    },
    responses: { '200': { description: 'The updated group' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const actor = this.actor(c);
    const now = new Date();
    if (body.status !== undefined && !(await setErrorStatus(db, params.id, body.status, actor, now))) {
      return c.json({ success: false, error: 'Error group not found' }, 404);
    }
    if (body.assignee !== undefined && !(await setErrorAssignee(db, params.id, body.assignee === 'me' ? actor : null, actor, now))) {
      return c.json({ success: false, error: 'Error group not found' }, 404);
    }
    logger.info('[Errors] Group updated', { id: params.id, status: body.status, assignee: body.assignee, by: actor.id });
    return { success: true, result: { group: await getErrorGroup(db, params.id) } };
  }
}

const NoteBody = z.object({ body: z.string().trim().min(1).max(NOTE_MAX) });

export class ErrorGroupAddNote extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Add a note to an error group',
    request: { params: IdParams, body: { content: { 'application/json': { schema: NoteBody } } } },
    responses: { '200': { description: 'The note' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const note = await addErrorNote(c.env.REPORTS_DB, params.id, body.body, this.actor(c), new Date());
    if (!note) return c.json({ success: false, error: 'Error group not found' }, 404);
    return { success: true, result: { note } };
  }
}

export class ErrorTestGroupDelete extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Delete a release E2E test error group by reference',
    description: 'Only groups whose every occurrence was a controlled test error (the release E2E cleans up after itself). Needs errors:manage.',
    request: { params: z.object({ ref: z.string().min(8).max(20) }) },
    responses: { '200': { description: 'Deleted count (0 when not a test group)' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:manage');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const ref = parseErrorRef(params.ref);
    const deleted = ref ? await deleteTestGroupByRef(c.env.REPORTS_DB, ref) : 0;
    logger.info('[Errors] Test group cleanup', { ref, deleted, by: this.getUserId(c) });
    return { success: true, result: { deleted } };
  }
}

const ActionParams = z.object({ id: z.string().regex(/^act_[0-9a-f]{20}$/) });

export class ErrorActionRetry extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Retry a needs-action item',
    description:
      "Runs the item's registered retry (lib/errors-actions.ts). Resolved when it works, open with the reason when it does not; recorded in the activity log. Needs errors:manage.",
    request: { params: ActionParams },
    responses: { '200': { description: 'Outcome and the updated item' }, '404': { description: 'Not found' }, '409': { description: 'Already closed or no retry' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:manage');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const item = await getActionItem(db, params.id);
    if (!item) return c.json({ success: false, error: 'Item not found' }, 404);
    const spec = parseRetry(item.retry_json);
    if (!spec) return c.json({ success: false, error: 'This item has no retry action' }, 409);
    const actor = this.actor(c);
    const now = new Date();
    const outcome = await runRetry(c.env, spec, `${now.getTime()}`);
    await recordActionAttempt(db, item, { status: outcome.status, result: outcome.result }, actor, now);
    logger.info('[Errors] Item retried', { id: item.id, key: item.item_key, ok: outcome.ok, by: actor.id });
    const { retry_json, ...updated } = (await getActionItem(db, params.id))!;
    return { success: true, result: { outcome, action: { ...updated, can_retry: !!parseRetry(retry_json) } } };
  }
}

export class ErrorActionUpdate extends ErrorsRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Resolve, dismiss or reopen a needs-action item',
    description: 'Recorded in the activity log. Needs errors:manage.',
    request: {
      params: ActionParams,
      body: { content: { 'application/json': { schema: z.object({ status: z.enum(['open', 'resolved', 'dismissed']) }) } } },
    },
    responses: { '200': { description: 'The updated item' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'errors:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const item = await getActionItem(db, params.id);
    if (!item) return c.json({ success: false, error: 'Item not found' }, 404);
    await recordActionAttempt(db, item, { status: body.status, result: `Marked ${body.status}` }, this.actor(c), new Date(), 'item');
    const { retry_json, ...updated } = (await getActionItem(db, params.id))!;
    return { success: true, result: { action: { ...updated, can_retry: !!parseRetry(retry_json) } } };
  }
}
