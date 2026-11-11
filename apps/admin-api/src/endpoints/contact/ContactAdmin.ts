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
  deliveryStatus,
  recordDelivery,
  type ContactNoteRow,
} from '../../lib/contact-store';
import { renderReply } from '../../lib/contact-email';
import { cleanTrashReason } from '@al-ummah/shared-types';
import { writeTrashAudit } from '../../lib/trash-audit';
import { enqueueContactMail, reportContactMailFailure, resolveContactMailItem } from '../../lib/contact-mail-queue';

const TAGS = ['Contact'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IdParams = z.object({ id: z.string().min(1).max(64) });

abstract class ContactRoute extends AdminRoute {
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
        assignee: z.enum(['me', 'unassigned']).optional(),
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

export class ContactCounts extends ContactRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Contact message counts by status',
    description: 'For the admin nav badge (new) and the inbox header. Needs contact:read.',
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
    summary: 'Change a contact message status or assignee',
    description: 'assignee: "me" assigns it to the caller, null unassigns. Needs contact:manage.',
    request: {
      params: IdParams,
      body: {
        content: {
          'application/json': {
            schema: z
              .object({ status: z.enum(CONTACT_STATUSES).optional(), assignee: z.enum(['me']).nullable().optional() })
              .refine((b) => b.status !== undefined || b.assignee !== undefined, 'Nothing to change'),
          },
        },
      },
    },
    responses: { '200': { description: 'The updated message' }, '404': { description: 'Not found' } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'contact:manage');
    if (denied) return denied;
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const auth = this.getAuth(c);
    const assignee = body.assignee === undefined ? undefined : body.assignee === 'me' ? { id: auth.userId, email: auth.email || null } : null;
    const found = await updateContactMessage(c.env.REPORTS_DB, params.id, { status: body.status, assignee }, new Date());
    if (!found) return c.json({ success: false, error: 'Message not found' }, 404);
    logger.info('[Contact] Message updated', { id: params.id, status: body.status, assignee: body.assignee, by: auth.userId });
    return { success: true, result: { message: await getContactMessage(c.env.REPORTS_DB, params.id) } };
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
    return { success: true, result: { deleted: params.id } };
  }
}
