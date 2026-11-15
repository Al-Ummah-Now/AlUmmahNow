/**
 * Newsletter mail off the request path, on CONTACT_MAIL_QUEUE (the shared Resend sender, like the
 * account warning and "video not approved" emails), consumed by lib/contact-mail-queue.ts:
 *
 * - `newsletter_confirm`: the double opt-in email for one sign-up (the job carries the token; only
 *   its hash is stored).
 * - `newsletter_fanout`: one page (FANOUT_PAGE) of confirmed subscribers → a queued delivery row and
 *   a `newsletter_send` job each, then the next page; the last page marks the issue fanned out.
 * - `newsletter_send`: one issue to one subscriber, in their language, with the unsubscribe link and
 *   List-Unsubscribe headers. Skipped when they unsubscribed meanwhile.
 *
 * Retries back off (backoffSeconds) up to MAX_ATTEMPTS; a final failure is marked on the row, goes
 * to the platform DLQ (ERRORS_DLQ) and becomes a needs-action item on the Errors page with Retry
 * ("newsletter-email" in lib/errors-actions.ts). Idempotent: a delivery already sent is never sent
 * again, and Resend gets an Idempotency-Key per email.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { logger } from './logger';
import { sendContactEmail } from './contact-email';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { renderConfirmEmail, renderIssueEmail, siteUrlOf } from './newsletter';
import {
  addDeliveries,
  confirmedPage,
  deliveryStatusOf,
  FANOUT_PAGE,
  finishIfDone,
  getIssue,
  getSubscriber,
  markFannedOut,
  setConfirmDelivery,
  setDelivery,
} from './newsletter-store';

export const NEWSLETTER_MAIL_VERSION = 1;

export type NewsletterMailJob =
  | { v: typeof NEWSLETTER_MAIL_VERSION; kind: 'newsletter_confirm'; subscriberId: string; token: string }
  | { v: typeof NEWSLETTER_MAIL_VERSION; kind: 'newsletter_fanout'; issueId: string; after: string }
  | { v: typeof NEWSLETTER_MAIL_VERSION; kind: 'newsletter_send'; issueId: string; subscriberId: string };

export function isNewsletterMailJob(body: unknown): body is NewsletterMailJob {
  const kind = !!body && typeof body === 'object' ? (body as { kind?: unknown }).kind : undefined;
  return kind === 'newsletter_confirm' || kind === 'newsletter_fanout' || kind === 'newsletter_send';
}

type QueueEnv = Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>;

/** Enqueues jobs (sendBatch takes at most 100). False when the queue refused them. */
export async function enqueueNewsletterMail(env: QueueEnv, jobs: NewsletterMailJob[]): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[Newsletter] CONTACT_MAIL_QUEUE is not bound');
    return false;
  }
  try {
    for (let i = 0; i < jobs.length; i += 100) {
      await env.CONTACT_MAIL_QUEUE.sendBatch(jobs.slice(i, i + 100).map((body) => ({ body, contentType: 'json' as const })));
    }
    return true;
  } catch (error) {
    logger.error('[Newsletter] Enqueue failed', { jobs: jobs.length, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export const confirmJob = (subscriberId: string, token: string): NewsletterMailJob => ({ v: NEWSLETTER_MAIL_VERSION, kind: 'newsletter_confirm', subscriberId, token });
export const fanoutJob = (issueId: string, after = ''): NewsletterMailJob => ({ v: NEWSLETTER_MAIL_VERSION, kind: 'newsletter_fanout', issueId, after });
export const sendJob = (issueId: string, subscriberId: string): NewsletterMailJob => ({ v: NEWSLETTER_MAIL_VERSION, kind: 'newsletter_send', issueId, subscriberId });

/** Needs-action item keys ("newsletter-email" retries them). One per sign-up, one per issue. */
export const confirmItemKey = (subscriberId: string) => `newsletter-confirm:${subscriberId}`.slice(0, 160);
export const issueItemKey = (issueId: string) => `newsletter-issue:${issueId}`.slice(0, 160);

/** Flags a final failure on the Errors page with Retry, and records it in the platform DLQ. Never throws. */
export async function reportNewsletterFailure(env: AdminBindings, job: NewsletterMailJob, reason: string, attempts: number): Promise<void> {
  const isConfirm = job.kind === 'newsletter_confirm';
  const id = isConfirm ? job.subscriberId : job.issueId;
  logger.error('[Newsletter] Mail failed for good', { alert: 'newsletter_mail_failed', kind: job.kind, id, attempts, reason });
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `${isConfirm ? 'Newsletter confirmation email' : 'Newsletter issue email'} not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: isConfirm ? confirmItemKey(id) : issueItemKey(id),
      source: 'email',
      title: isConfirm ? 'Newsletter confirmation email not sent' : 'Newsletter issue not sent to everyone',
      itemType: isConfirm ? 'newsletter-subscriber' : 'newsletter-issue',
      itemId: id,
      itemUrl: isConfirm ? `/newsletter?tab=subscribers` : `/newsletter?issue=${encodeURIComponent(id)}`,
      retry: { kind: 'builtin', handler: 'newsletter-email', args: isConfirm ? { kind: 'confirm', id } : { kind: 'issue', id } },
      retryLabel: 'Send again',
    },
  });
  if (event) {
    try {
      // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
      const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
      await ingestAndAlert(env, [event]);
    } catch (error) {
      logger.error('[Newsletter] Could not flag the failure on the Errors page', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    // The token never leaves the queue message: the DLQ record names the subscriber only
    const safeJob = isConfirm ? { v: job.v, kind: job.kind, subscriberId: job.subscriberId } : job;
    await env.ERRORS_DLQ?.send({ id: `${job.kind}-${id}${job.kind === 'newsletter_send' ? `-${job.subscriberId}` : ''}`, type: 'newsletter_mail', failureReason: `${job.kind} ${id} failed after ${attempts} attempt(s): ${reason}`.slice(0, 1000), job: safeJob });
  } catch (error) {
    logger.error('[Newsletter] Could not report to the DLQ', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Closes an Errors page item once a retry worked. Never throws. */
export async function resolveNewsletterItem(env: AdminBindings, key: string): Promise<void> {
  try {
    const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
    await enqueueIngest(env, { v: 1, events: [], resolved: [key], trustedRetry: true, receivedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[Newsletter] Could not resolve the Errors page item', { error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';

async function processConfirm(env: AdminBindings, job: Extract<NewsletterMailJob, { kind: 'newsletter_confirm' }>, attempts: number): Promise<Outcome> {
  const db = env.REPORTS_DB;
  const sub = await getSubscriber(db, job.subscriberId);
  // Gone, confirmed meanwhile or unsubscribed: nothing to send
  if (!sub || sub.status !== 'pending') return 'done';
  if (sub.confirm_status === 'sent' || sub.confirm_status === 'sunk') return 'done';
  const email = renderConfirmEmail({ to: sub.email, locale: sub.locale, token: job.token, site: siteUrlOf(env as never), environment: env.ENVIRONMENT });
  // The token changes on every new sign-up request, so the key does too
  const result = await sendContactEmail(env, email, { idempotencyKey: `newsletter-confirm-${sub.id}-${job.token.slice(0, 12)}` });
  if (result.status !== 'failed') {
    await setConfirmDelivery(db, sub.id, result.status === 'sunk' ? 'sunk' : 'sent');
    return 'done';
  }
  if (result.retryable && attempts < MAX_ATTEMPTS) return 'retry';
  await setConfirmDelivery(db, sub.id, 'failed', result.error ?? 'send failed');
  await reportNewsletterFailure(env, job, result.error ?? 'send failed', attempts);
  return 'failed';
}

async function processFanout(env: AdminBindings, job: Extract<NewsletterMailJob, { kind: 'newsletter_fanout' }>, attempts: number, now: () => Date): Promise<Outcome> {
  const db = env.REPORTS_DB;
  const issue = await getIssue(db, job.issueId);
  if (!issue || issue.status === 'draft') return 'done';
  const ids = await confirmedPage(db, job.after, FANOUT_PAGE);
  await addDeliveries(db, issue.id, ids, now());
  const jobs: NewsletterMailJob[] = ids.map((sid) => sendJob(issue.id, sid));
  if (ids.length === FANOUT_PAGE) jobs.push(fanoutJob(issue.id, ids[ids.length - 1]));
  if (jobs.length && !(await enqueueNewsletterMail(env, jobs))) {
    if (attempts < MAX_ATTEMPTS) return 'retry';
    await reportNewsletterFailure(env, job, 'could not queue the emails', attempts);
    return 'failed';
  }
  if (ids.length < FANOUT_PAGE) {
    await markFannedOut(db, issue.id, now());
    await finishIfDone(db, issue.id, now());
  }
  return 'done';
}

async function processSend(env: AdminBindings, job: Extract<NewsletterMailJob, { kind: 'newsletter_send' }>, attempts: number, now: () => Date): Promise<Outcome> {
  const db = env.REPORTS_DB;
  const current = await deliveryStatusOf(db, job.issueId, job.subscriberId);
  if (current !== 'queued') return 'done';
  const [issue, sub] = await Promise.all([getIssue(db, job.issueId), getSubscriber(db, job.subscriberId)]);
  if (!issue) return 'done';
  if (!sub || sub.status !== 'confirmed') {
    await setDelivery(db, job.issueId, job.subscriberId, 'skipped', now());
    await finishIfDone(db, job.issueId, now());
    return 'done';
  }
  const email = renderIssueEmail({ to: sub.email, locale: sub.locale, issue, unsubscribeToken: sub.unsubscribe_token, site: siteUrlOf(env as never), environment: env.ENVIRONMENT });
  const result = await sendContactEmail(env, email, { idempotencyKey: `newsletter-${issue.id}-${sub.id}` });
  if (result.status !== 'failed') {
    await setDelivery(db, job.issueId, job.subscriberId, result.status === 'sunk' ? 'sunk' : 'sent', now(), { providerId: result.id });
    await finishIfDone(db, job.issueId, now());
    return 'done';
  }
  if (result.retryable && attempts < MAX_ATTEMPTS) return 'retry';
  await setDelivery(db, job.issueId, job.subscriberId, 'failed', now(), { error: result.error ?? 'send failed' });
  await finishIfDone(db, job.issueId, now());
  await reportNewsletterFailure(env, job, result.error ?? 'send failed', attempts);
  return 'failed';
}

/** Runs one newsletter job. Never throws; the consumer acks or retries by the outcome. */
export async function processNewsletterMailJob(env: AdminBindings, msg: QueueMessageLike<NewsletterMailJob>, now = () => new Date()): Promise<Outcome> {
  const job = msg.body;
  try {
    if (job.v !== NEWSLETTER_MAIL_VERSION) {
      logger.error('[Newsletter] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    if (job.kind === 'newsletter_confirm') return job.subscriberId && job.token ? await processConfirm(env, job, msg.attempts) : 'done';
    if (job.kind === 'newsletter_fanout') return job.issueId ? await processFanout(env, job, msg.attempts, now) : 'done';
    return job.issueId && job.subscriberId ? await processSend(env, job, msg.attempts, now) : 'done';
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[Newsletter] Job errored; will retry', { kind: job.kind, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    await reportNewsletterFailure(env, job, reason, msg.attempts);
    return 'failed';
  }
}
