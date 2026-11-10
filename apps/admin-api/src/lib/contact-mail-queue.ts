/**
 * Contact us mail runs off the request path: requests enqueue one message per
 * email on CONTACT_MAIL_QUEUE (al-ummah-now-contact-mail[-env]) and this
 * worker's queue consumer sends it.
 *
 * - Retries: failures worth retrying (network, 429, 5xx) back off
 *   exponentially (30 s, 1, 2, 4, 8 min) up to MAX_ATTEMPTS.
 * - Final failure (attempts used up, or a permanent error such as no key or a
 *   refused address): the delivery is marked failed, the message is flagged
 *   (send_failed_at, shown in the admin inbox with a Retry button) and a record
 *   goes to the platform DLQ (ERRORS_DLQ, al-ummah-now-dlq[-env]): the
 *   processor logs it as a `[DLQ]` alert and keeps it in dead_letters. The
 *   queue's own dead_letter_queue is that DLQ too, as a backstop.
 * - Idempotent: a delivery already sent (or sunk/skipped) is not sent again,
 *   and Resend gets an Idempotency-Key per email.
 */
import type { AdminBindings } from '../base/types';
import { logger } from './logger';
import { isSinkAddress } from './contact';
import { getContactMessage, deliveryStatus, recordDelivery, type MailKind } from './contact-store';
import { renderAcknowledgement, renderInboxNotification, renderReply, sendContactEmail } from './contact-email';

export const CONTACT_MAIL_VERSION = 1;
/** Keep equal to max_retries + 1 of the contact-mail consumer in wrangler*.jsonc. */
export const MAX_ATTEMPTS = 6;

export interface ContactMailJob {
  v: typeof CONTACT_MAIL_VERSION;
  kind: MailKind;
  messageId: string;
  /** Replies: the contact_notes row */
  noteId?: string;
}

export interface QueueMessageLike<T> {
  id: string;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/** Seconds before attempt n+1 after attempt n failed: 30 s doubling, at most 15 min. */
export function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 900);
}

/** Delivery states after which an email is never sent again. */
const DONE = new Set(['sent', 'sunk', 'skipped']);

/**
 * Enqueues the jobs. Returns false when the queue refused them: the caller
 * marks those deliveries failed so an admin sees them and can retry.
 */
export async function enqueueContactMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, jobs: ContactMailJob[]): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[ContactMail] CONTACT_MAIL_QUEUE is not bound');
    return false;
  }
  try {
    await env.CONTACT_MAIL_QUEUE.sendBatch(jobs.map((body) => ({ body, contentType: 'json' as const })));
    return true;
  } catch (error) {
    logger.error('[ContactMail] Enqueue failed', { error: error instanceof Error ? error.message : String(error), jobs: jobs.length });
    return false;
  }
}

/** Reports a final failure to the platform errors pipeline (processor DLQ consumer → dead_letters). */
export async function reportContactMailFailure(env: Pick<AdminBindings, 'ERRORS_DLQ' | 'ENVIRONMENT'>, job: ContactMailJob, reason: string, attempts: number): Promise<void> {
  logger.error('[ContactMail] Delivery failed for good', { alert: 'contact_mail_failed', environment: env.ENVIRONMENT, ...job, attempts, reason });
  try {
    await env.ERRORS_DLQ?.send({
      id: `contact-${job.kind}-${job.noteId ?? job.messageId}`,
      type: 'contact_mail',
      failureReason: `Contact ${job.kind} email for message ${job.messageId} failed after ${attempts} attempt(s): ${reason}`.slice(0, 1000),
      job,
    });
  } catch (error) {
    // The message is already flagged in the inbox; the log line above is the alert
    logger.error('[ContactMail] Could not report to the DLQ', { error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';

/** Sends one job. Never throws; the caller acks or retries by the outcome. */
export async function processContactMailJob(env: AdminBindings, msg: QueueMessageLike<ContactMailJob>, now = () => new Date()): Promise<Outcome> {
  const job = msg.body;
  const db = env.REPORTS_DB;
  const fail = async (reason: string): Promise<Outcome> => {
    await recordDelivery(db, { messageId: job.messageId, kind: job.kind, noteId: job.noteId, status: 'failed', error: reason, now: now() });
    await reportContactMailFailure(env, job, reason, msg.attempts);
    return 'failed';
  };

  try {
    if (!job || job.v !== CONTACT_MAIL_VERSION || !['notify', 'ack', 'reply'].includes(job.kind) || !job.messageId) {
      logger.error('[ContactMail] Malformed job dropped', { id: msg.id });
      await reportContactMailFailure(env, job ?? ({} as ContactMailJob), 'malformed job', msg.attempts);
      return 'done';
    }
    const message = await getContactMessage(db, job.messageId);
    // Deleted since it was queued: nothing to send
    if (!message) return 'done';
    const current = await deliveryStatus(db, job.messageId, job.kind, job.noteId);
    if (current === undefined) return 'done';
    if (current && DONE.has(current)) return 'done';

    const inbox = env.CONTACT_INBOX?.trim() || undefined;
    let result: Awaited<ReturnType<typeof sendContactEmail>>;
    if (job.kind === 'notify') {
      if (!inbox) result = { status: 'skipped' };
      // A test message (E2E address outside production) never reaches the real inbox
      else if (isSinkAddress(message.email, env.ENVIRONMENT)) result = { status: 'sunk' };
      else result = await sendContactEmail(env, renderInboxNotification(message, { to: inbox, adminUrl: env.ADMIN_WEB_URL, environment: env.ENVIRONMENT }), { idempotencyKey: `contact-notify-${message.id}` });
    } else if (job.kind === 'ack') {
      result = await sendContactEmail(env, renderAcknowledgement(message, { replyTo: inbox, environment: env.ENVIRONMENT }), { idempotencyKey: `contact-ack-${message.id}` });
    } else {
      const note = await db.prepare('SELECT body FROM contact_notes WHERE id = ? AND message_id = ?').bind(job.noteId ?? '', job.messageId).first<{ body: string }>();
      if (!note) return 'done';
      result = await sendContactEmail(env, renderReply(message, note.body, { replyTo: inbox, environment: env.ENVIRONMENT }), { idempotencyKey: `contact-reply-${job.noteId}` });
    }

    if (result.status !== 'failed') {
      await recordDelivery(db, { messageId: job.messageId, kind: job.kind, noteId: job.noteId, status: result.status, providerId: result.id, now: now() });
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[ContactMail] Send failed; will retry', { ...job, attempts: msg.attempts, error: result.error });
      return 'retry';
    }
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[ContactMail] Job errored; will retry', { ...job, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    try {
      return await fail(reason);
    } catch {
      // D1 itself is failing: let the queue dead-letter it (backstop DLQ)
      return 'retry';
    }
  }
}

/** Queue consumer for CONTACT_MAIL_QUEUE. */
export async function contactMailConsumer(batch: { messages: readonly QueueMessageLike<ContactMailJob>[] }, env: AdminBindings): Promise<void> {
  for (const msg of batch.messages) {
    const outcome = await processContactMailJob(env, msg);
    if (outcome === 'retry') msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
    else msg.ack();
  }
}
