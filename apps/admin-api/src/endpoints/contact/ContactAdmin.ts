/**
 * Contact us inbox for admin-web (/contact). Every route needs contact:read,
 * and changes need contact:manage (lib/roles.ts PERMISSIONS: admins and
 * super admins; moderators are refused).
 */
import { z } from 'zod';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { hasPermission, type Permission } from '../../lib/roles';
import { CONTACT_LIMITS, CONTACT_STATUSES, CONTACT_TOPICS } from '../../lib/contact';
import {
  contactCounts,
  softDeleteContactMessage,
  getContactMessage,
  getContactThread,
  insertContactNote,
  listContactMessages,
  updateContactMessage,
  updateContactMessages,
  restoreContactMessage,
  deliveryStatus,
  recordDelivery,
  type ContactNoteRow,
} from '../../lib/contact-store';
import { renderReply } from '../../lib/contact-email';
import { cleanTrashReason } from '@al-ummah/shared-types';
import { writeTrashAudit } from '../../lib/trash-audit';
import { CONTACT_QUEUE_OUTCOMES, CONTACT_QUEUE_SORTS } from '@al-ummah/shared-types';
import { listContactQueue } from '../../lib/queue/contact-queue';
import { assigneeParam, queueQuery, toFilters } from '../../lib/queue/schema';
import { enqueueContactMail, reportContactMailFailure, resolveContactMailItem } from '../../lib/contact-mail-queue';
import { publishAdminLiveInBackground } from '../../lib/admin-live';
import { callVideos, type VideosClientEnv } from '../../lib/content/videosClient';

/** Auth RBAC role ids whose holders have contact:manage (lib/roles.ts PERMISSIONS: admins and super admins). */
const CONTACT_STAFF_ROLES = 'role_super_admin,role_admin';

interface StaffAccount { id: string; email: string; name: string | null }

/**
 * Everyone who can handle contact messages: every live account holding an admin role, read by
 * api-videos from the role assignments (GET /internal/admin/staff), not only those who opened the inbox.
 */
async function contactStaff(env: VideosClientEnv): Promise<StaffAccount[]> {
  const { items } = await callVideos<{ items: StaffAccount[] }>(env, '/staff', { query: { roles: CONTACT_STAFF_ROLES } });
  return items;
}

/** Every change to a message refreshes the inbox, its badge and open detail pages (admin live events). */
function announce(c: AppContext): void {
  publishAdminLiveInBackground(c, 'moderation', { kind: 'changed', key: 'contact', queue: 'contact' });
}

const TAGS = ['Contact'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IdParams = z.object({ id: z.string().min(1).max(64) });

abstract class ContactRoute extends AdminRoute {
  /**
   * The assignee a body names: 'me', the id of an admin who can handle
   * contact messages, or null. Anyone else is refused (ok false).
   */
  protected async assigneeFor(c: AppContext, value: string | null | undefined): Promise<{ ok: true; assignee: { id: string; email: string | null } | null | undefined } | { ok: false }> {
    if (value === undefined) return { ok: true, assignee: undefined };
    if (value === null) return { ok: true, assignee: null };
    const auth = this.getAuth(c);
    if (value === 'me' || value === auth.userId) return { ok: true, assignee: { id: auth.userId, email: auth.email || null } };
    const staff = (await contactStaff(c.env as never)).find((s) => s.id === value);
    return staff ? { ok: true, assignee: { id: staff.id, email: staff.email } } : { ok: false };
  }

  /** A 403 response when the caller lacks the permission, otherwise null. */
  protected deny(c: AppContext, permission: Permission): Response | null {
    if (hasPermission(this.getRoles(c), permission)) return null;
    logger.warn('[Contact] Permission denied', { userId: this.getUserId(c), permission, path: c.req.path });
    return c.json({ success: false, error: `Permission required: ${permission}` }, 403);
  }
}

export class ContactList extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'List contact messages',
    description: 'Newest first. Filters: status, topic, created date range (UTC days), search in name/email/message, assignee. Needs contact:read.',
    request: {
      query: z.object({
        status: z.enum([...CONTACT_STATUSES, 'send_failed']).optional(),
        topic: z.enum(CONTACT_TOPICS).optional(),
        from: z.string().regex(DAY).optional(),
        to: z.string().regex(DAY).optional(),
        q: z.string().trim().max(200).optional(),
        assignee: z.string().trim().min(1).max(64).optional(),
        read: z.enum(['unread', 'read']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: { '200': { description: 'Messages and the total matching the filters' }, '403': { description: 'contact:read required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:read');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    const result = await listContactMessages(c.env.REPORTS_DB, { ...query, q: query.q || undefined, viewerId: this.getUserId(c) });
    return { success: true, result: { ...result, limit: query.limit, offset: query.offset } };
  }
}

export class ContactQueue extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Contact messages as a queue: Action needed / History (docs/admin/QUEUES.md)',
    description:
      'tab=action: new and open messages and any with a failed delivery, oldest first. tab=history: replied, closed and spam messages with who handled them and when, newest first. q searches sender name and email, message text and topic; category = topic, outcome = replied|closed|spam, actor = who handled it (id or me), assignee = me|unassigned|id. Assignees and handlers are names. counts holds both tabs under the same filters. Needs contact:read.',
    request: {
      query: queueQuery(CONTACT_QUEUE_SORTS, CONTACT_QUEUE_OUTCOMES).extend({ category: z.enum(CONTACT_TOPICS).optional(), assignee: assigneeParam }),
    },
    responses: { '200': { description: 'AdminQueuePage<ContactQueueItem>' }, '403': { description: 'contact:read required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:read');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    const result = await listContactQueue(c.env.REPORTS_DB, c.env.SEARCH_DB, toFilters(query, this.getUserId(c)));
    logger.debug('[Contact] Queue listed', { tab: query.tab, total: result.total, searched: !!query.q });
    return { success: true, result };
  }
}

export class ContactCounts extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Contact message counts by status',
    description: 'For the admin nav badge (unread: not yet read and not spam) and the inbox views. Needs contact:read.',
    responses: { '200': { description: 'Counts per status' }, '403': { description: 'contact:read required' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:read');
    if (denied) return denied;
    return { success: true, result: await contactCounts(c.env.REPORTS_DB) };
  }
}

export class ContactGet extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Get a contact message and its staff thread',
    request: { params: IdParams },
    responses: { '200': { description: 'The message and its notes and replies, oldest first' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:read');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const thread = await getContactThread(c.env.REPORTS_DB, params.id);
    if (!thread) return c.json({ success: false, error: 'Message not found' }, 404);
    return { success: true, result: thread };
  }
}

export class ContactUpdate extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Change a contact message: status, read/unread, assignee',
    description:
      'status: open, in_progress, replied, closed or spam. read: true marks it read (keeps the first read time), false unread. assignee: "me", the id of an admin who can handle contact messages (GET /api/contact/staff), or null to unassign. Needs contact:manage.',
    request: {
      params: IdParams,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ status: z.enum(CONTACT_STATUSES).optional(), read: z.boolean().optional(), assignee: z.string().trim().min(1).max(64).nullable().optional() })
              .refine((b) => b.status !== undefined || b.read !== undefined || b.assignee !== undefined, 'Nothing to change'),
          },
        },
      },
    },
    responses: { '200': { description: 'The updated message' }, '400': { description: 'The assignee cannot handle contact messages' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    const assignee = await this.assigneeFor(c, body.assignee);
    if (!assignee.ok) return c.json({ success: false, error: 'not_staff' }, 400);
    const found = await updateContactMessage(
      c.env.REPORTS_DB,
      params.id,
      { status: body.status, read: body.read, assignee: assignee.assignee, actor: { id: auth.userId, email: auth.email || null } },
      new Date(),
    );
    if (!found) return c.json({ success: false, error: 'Message not found' }, 404);
    logger.info('[Contact] Message updated', { id: params.id, status: body.status, read: body.read, assigned: body.assignee !== undefined, by: auth.userId });
    announce(c);
    return { success: true, result: { message: await getContactMessage(c.env.REPORTS_DB, params.id) } };
  }
}

const BULK_MAX = 100;

export class ContactBulk extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Change or delete many contact messages at once',
    description:
      'ids (1-100) and exactly one change: status, read, assignee (as for PATCH), or delete: true (soft delete, restorable for 30 days; undo with POST /messages/restore). Idempotent: repeating it changes nothing more. Needs contact:manage.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z
              .object({
                ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX),
                status: z.enum(CONTACT_STATUSES).optional(),
                read: z.boolean().optional(),
                assignee: z.string().trim().min(1).max(64).nullable().optional(),
                delete: z.literal(true).optional(),
              })
              .refine((b) => [b.status, b.read, b.assignee, b.delete].filter((v) => v !== undefined).length === 1, 'Exactly one change'),
          },
        },
      },
    },
    responses: { '200': { description: '{ ok: ids changed, missing: ids not found }' }, '400': { description: 'The assignee cannot handle contact messages' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { body } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    const db = c.env.REPORTS_DB;
    const now = new Date();
    let result: { ok: string[]; missing: string[] };
    if (body.delete) {
      result = { ok: [], missing: [] };
      for (const id of [...new Set<string>(body.ids as string[])]) {
        if (await softDeleteContactMessage(db, id, { actorId: auth.userId, reason: null, now })) {
          await writeTrashAudit(db, { kind: 'contact-message', id, action: 'delete', actorId: auth.userId, reason: null }, now);
          result.ok.push(id);
        } else result.missing.push(id);
      }
    } else {
      const assignee = await this.assigneeFor(c, body.assignee);
      if (!assignee.ok) return c.json({ success: false, error: 'not_staff' }, 400);
      result = await updateContactMessages(db, body.ids, { status: body.status, read: body.read, assignee: assignee.assignee, actor: { id: auth.userId, email: auth.email || null } }, now);
    }
    logger.info('[Contact] Bulk change', { count: body.ids.length, ok: result.ok.length, change: body.delete ? 'delete' : body.status ? 'status' : body.read !== undefined ? 'read' : 'assignee', by: auth.userId });
    if (result.ok.length) announce(c);
    return { success: true, result };
  }
}

export class ContactRestore extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Undo a delete: bring soft-deleted contact messages back',
    description: 'ids (1-100) deleted in the last 30 days and not purged yet. Idempotent. Needs contact:manage.',
    request: { body: { content: { 'application/json': { schema: z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX) }) } } } },
    responses: { '200': { description: '{ ok: ids restored, missing: ids not deleted or already purged }' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { body } = await this.getValidatedData<typeof this.schema>();
    const actorId = this.getUserId(c);
    const now = new Date();
    const result = { ok: [] as string[], missing: [] as string[] };
    for (const id of [...new Set<string>(body.ids as string[])]) {
      if (await restoreContactMessage(c.env.REPORTS_DB, id)) {
        await writeTrashAudit(c.env.REPORTS_DB, { kind: 'contact-message', id, action: 'restore', actorId, reason: null }, now);
        result.ok.push(id);
      } else result.missing.push(id);
    }
    logger.info('[Contact] Messages restored', { ok: result.ok.length, by: actorId });
    if (result.ok.length) announce(c);
    return { success: true, result };
  }
}

export class ContactStaff extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Admins a contact message can be assigned to',
    description: 'Every account that can handle contact messages (admins and super admins, from the role assignments), matched by name or email. Shaped as autocomplete suggestions. Needs contact:manage.',
    request: { query: z.object({ q: z.string().trim().max(200).default(''), limit: z.coerce.number().int().min(1).max(200).default(200) }) },
    responses: { '200': { description: '{ items: { id, label, secondary }[] }' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    const me = this.getUserId(c);
    const q = query.q.toLocaleLowerCase();
    const staff = (await contactStaff(c.env as never)).filter((s) => !q || s.email.toLocaleLowerCase().includes(q) || (s.name ?? '').toLocaleLowerCase().includes(q) || s.id === query.q);
    // The caller first, then by name; label = name (else email), email beside it
    staff.sort((a, b) => Number(b.id === me) - Number(a.id === me));
    const items = staff.slice(0, query.limit).map((s) => ({ kind: 'user' as const, id: s.id, label: s.name ?? s.email, secondary: s.id === me ? 'me' : s.name ? s.email : null, imageUrl: null }));
    return { success: true, result: { items } };
  }
}

const NoteBody = z.object({ body: z.string().trim().min(1).max(CONTACT_LIMITS.noteMax) });

export class ContactAddNote extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Add an internal note to a contact message',
    description: 'Staff only; never sent to the sender. Needs contact:manage.',
    request: { params: IdParams, body: { content: { 'application/json': { schema: NoteBody } } } },
    responses: { '200': { description: 'The new note' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    if (!(await getContactMessage(db, params.id))) return c.json({ success: false, error: 'Message not found' }, 404);
    const auth = this.getAuth(c);
    const note: ContactNoteRow = {
      id: crypto.randomUUID(),
      message_id: params.id,
      kind: 'note',
      body: body.body,
      author_id: auth.userId,
      author_email: auth.email || null,
      email_to: null,
      email_subject: null,
      email_status: null,
      email_id: null,
      created_at: new Date().toISOString(),
    };
    await insertContactNote(db, note);
    return { success: true, result: { note } };
  }
}

/** locale: the language the admin picked next to Send; the message's language when left out. */
const ReplyBody = z.object({ body: z.string().trim().min(1).max(CONTACT_LIMITS.replyMax), locale: z.enum(['en', 'ar']).optional() });

export class ContactReply extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Reply to the sender by email',
    description:
      "Records the reply in the thread and queues the email (in ONE language: `locale`, picked by the admin next to Send, else the message's language; original quoted, from the platform sender). The mail queue retries; a reply that finally fails is flagged on the message for a retry. Spam cannot be replied to. Needs contact:manage.",
    request: { params: IdParams, body: { content: { 'application/json': { schema: ReplyBody } } } },
    responses: {
      '200': { description: 'The recorded reply; note.email_status is queued (or failed if it could not be queued)' },
      '404': { description: 'Not found' },
      '409': { description: 'The message is marked as spam' },
    },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const message = await getContactMessage(db, params.id);
    if (!message) return c.json({ success: false, error: 'Message not found' }, 404);
    if (message.status === 'spam') return c.json({ success: false, error: 'The message is marked as spam' }, 409);

    const auth = this.getAuth(c);
    const id = crypto.randomUUID();
    const now = new Date();
    const note: ContactNoteRow = {
      id,
      message_id: params.id,
      kind: 'reply',
      body: body.body,
      author_id: auth.userId,
      author_email: auth.email || null,
      email_to: message.email,
      // The subject records the chosen language: the queue (and any retry) sends in it
      email_subject: renderReply(message, body.body, { environment: c.env.ENVIRONMENT, locale: body.locale }).subject,
      email_status: 'queued',
      email_id: null,
      created_at: now.toISOString(),
    };
    await insertContactNote(db, note);
    // Sent by the queue consumer, never on this request
    if (!(await enqueueContactMail(c.env, [{ v: 1, kind: 'reply', messageId: params.id, noteId: id }]))) {
      await recordDelivery(db, { messageId: params.id, kind: 'reply', noteId: id, status: 'failed', error: 'could not queue the email', now });
      await reportContactMailFailure(c.env, { v: 1, kind: 'reply', messageId: params.id, noteId: id }, 'could not queue the email', 0);
    }
    logger.info('[Contact] Reply queued', { id: params.id, noteId: id, by: auth.userId });
    announce(c);
    const thread = await getContactThread(db, params.id);
    return { success: true, result: { note: thread?.notes.find((n) => n.id === id) ?? note, message: thread?.message ?? null } };
  }
}

export class ContactRetryDelivery extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Retry an email that failed to send',
    description: 'kind: notify (support inbox), ack (acknowledgement) or reply (with noteId). Only a failed delivery can be retried; it is queued again. Needs contact:manage.',
    request: {
      params: IdParams,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ kind: z.enum(['notify', 'ack', 'reply']), noteId: z.string().min(1).max(64).optional() })
              .refine((b) => b.kind !== 'reply' || !!b.noteId, 'noteId is required for a reply'),
          },
        },
      },
    },
    responses: { '200': { description: 'Queued again' }, '404': { description: 'Not found' }, '409': { description: 'That email has not failed' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.REPORTS_DB;
    const current = await deliveryStatus(db, params.id, body.kind, body.noteId);
    if (current === undefined) return c.json({ success: false, error: 'Message not found' }, 404);
    if (current !== 'failed') return c.json({ success: false, error: 'That email has not failed' }, 409);
    const now = new Date();
    await recordDelivery(db, { messageId: params.id, kind: body.kind, noteId: body.noteId, status: 'queued', now });
    const job = { v: 1 as const, kind: body.kind, messageId: params.id, ...(body.noteId ? { noteId: body.noteId } : {}) };
    if (!(await enqueueContactMail(c.env, [job]))) {
      await recordDelivery(db, { messageId: params.id, kind: body.kind, noteId: body.noteId, status: 'failed', error: 'could not queue the email', now });
      return c.json({ success: false, error: 'Could not queue the email' }, 503);
    }
    logger.info('[Contact] Delivery retried', { id: params.id, kind: body.kind, noteId: body.noteId, by: this.getUserId(c) });
    await resolveContactMailItem(c.env, job);
    const thread = await getContactThread(db, params.id);
    return { success: true, result: { message: thread?.message ?? null, notes: thread?.notes ?? [] } };
  }
}

export class ContactDelete extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Delete a contact message and its thread (soft delete)',
    description:
      'For spam and erasure requests. The message is hidden at once and can be restored for 30 days (/api/trash); the hourly cleanup then deletes it for good. Optional body { reason }. Needs contact:manage.',
    // The optional JSON body { reason } (up to TRASH_REASON_MAX characters) is read by hand: a DELETE may have no body
    request: { params: IdParams },
    responses: { '200': { description: 'Deleted (restorable)' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params } = await this.getValidatedData<typeof this.schema>();
    const input = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = cleanTrashReason(input?.reason);
    const actorId = this.getUserId(c);
    const now = new Date();
    if (!(await softDeleteContactMessage(c.env.REPORTS_DB, params.id, { actorId, reason, now }))) return c.json({ success: false, error: 'Message not found' }, 404);
    await writeTrashAudit(c.env.REPORTS_DB, { kind: 'contact-message', id: params.id, action: 'delete', actorId, reason }, now);
    logger.info('[Contact] Message deleted (restorable for 30 days)', { id: params.id, by: actorId });
    announce(c);
    return { success: true, result: { deleted: params.id } };
  }
}
