/**
 * The "video not approved" email (wiki AUN-VIDEO-REVIEW, AlUmmahNow#1279).
 *
 * The in-app `reviewRejected` notification is always sent by api-videos; this is the email beside
 * it. A reviewer's rejection queues a job on CONTACT_MAIL_QUEUE (shared Resend sender, like the
 * account warning email, lib/warning-mail.ts), delayed until the decision can no longer be undone
 * (REVIEW_UNDO_MINUTES). At send time the job checks that the review is still that rejection, so
 * an undone or re-decided review sends nothing.
 *
 * One language only: the creator's saved email language, else the language of the admin who
 * rejected it (kept on the job, so a Retry sends the same). It names the video, the reason
 * (REVIEW_REASON_CODES, the creator-facing text Studio shows) and links to the video in Studio,
 * where the creator can edit and resubmit or appeal. "Email me about my account" off means no
 * email. A final failure is a needs-action item on the Errors page with Retry
 * ("review-rejection-email" in lib/errors-actions.ts). No migration: the Resend idempotency key
 * (review id + decision time) keeps a retried job from sending twice.
 */
import {
  REVIEW_UNDO_MINUTES,
  STUDIO_AR,
  STUDIO_EN,
  accountEmailDecision,
  isReviewReasonCode,
  newErrorRef,
  scrubEvent,
  type AccountEmailContact,
  type NotificationEmailLocale,
} from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { callVideos, VideosError, type VideosClientEnv } from '../content/videosClient';
import { envTag, sendContactEmail, type RenderedEmail } from '../contact-email';
import { renderEmail, type EmailDoc } from '../email/layout';
import { MAX_ATTEMPTS, type QueueMessageLike } from '../contact-mail-queue';
import { videosWebOrigin } from '../invites';
import { logger } from '../logger';

export const REJECTION_MAIL_VERSION = 1;

export interface RejectionMailJob {
  v: typeof REJECTION_MAIL_VERSION;
  kind: 'review_rejected';
  reviewId: string;
  /** The rejection this email is about: a later decision on the same review sends nothing */
  decidedAt: string;
  /** The rejecting admin's UI language, used when the creator never picked an email language */
  adminLocale: NotificationEmailLocale;
}

export function isRejectionMailJob(body: unknown): body is RejectionMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'review_rejected';
}

export const rejectionMailJob = (reviewId: string, decidedAt: string, adminLocale: NotificationEmailLocale): RejectionMailJob => ({
  v: REJECTION_MAIL_VERSION,
  kind: 'review_rejected',
  reviewId,
  decidedAt,
  adminLocale,
});

/** Delay before sending: the undo window plus a minute, so an undone rejection never emails. */
export const REJECTION_MAIL_DELAY_SECONDS = REVIEW_UNDO_MINUTES * 60 + 60;

/**
 * Queues the email after the undo window. False when the queue refused it; the caller then
 * flags it (the decision itself stands).
 */
export async function enqueueRejectionMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, job: RejectionMailJob, delaySeconds = REJECTION_MAIL_DELAY_SECONDS): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[RejectionMail] CONTACT_MAIL_QUEUE is not bound');
    return false;
  }
  try {
    await env.CONTACT_MAIL_QUEUE.send(job as never, { contentType: 'json', delaySeconds });
    return true;
  } catch (error) {
    logger.error('[RejectionMail] Enqueue failed', { reviewId: job.reviewId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const COPY = {
  en: {
    subject: 'Your video was not approved',
    greeting: (name: string) => (name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'),
    intro: (title: string) => (title ? `A reviewer checked your video "${title}" and did not approve it, so it is not public.` : 'A reviewer checked your video and did not approve it, so it is not public.'),
    reason: 'Reason',
    next: 'Open it in Studio to edit it and send it for checking again, or to appeal. You can appeal once, and a different reviewer decides.',
    guidelines: 'Community guidelines',
    preheader: 'Open it in Studio to edit and resubmit it, or to appeal.',
    heading: 'Your video was not approved',
    cta: 'Open in Studio',
    settings: 'You can turn these emails off in your notification settings:',
    settingsLink: 'Notification settings',
    footer: 'You received this email because a reviewer decided on a video on your Al Ummah Now channel.',
    sign: 'Al Ummah Now',
  },
  ar: {
    subject: 'لم تتم الموافقة على مرئيك',
    greeting: (name: string) => (name ? `السلام عليكم ${name}،` : 'السلام عليكم،'),
    intro: (title: string) => (title ? `راجع أحد المراجعين مرئيك «${title}» ولم يوافق عليه، لذلك لم يُنشر.` : 'راجع أحد المراجعين مرئيك ولم يوافق عليه، لذلك لم يُنشر.'),
    reason: 'السبب',
    next: 'افتحه في الاستوديو لتعديله وإرساله للمراجعة مرة أخرى، أو للاعتراض. يمكنك الاعتراض مرة واحدة، ويقرر فيه مراجع آخر.',
    guidelines: 'إرشادات المجتمع',
    preheader: 'افتحه في الاستوديو لتعديله وإعادة إرساله أو للاعتراض.',
    heading: 'لم تتم الموافقة على مرئيك',
    cta: 'فتح في الاستوديو',
    settings: 'يمكنك إيقاف هذه الرسائل من إعدادات الإشعارات:',
    settingsLink: 'إعدادات الإشعارات',
    footer: 'وصلتك هذه الرسالة لأن أحد المراجعين قرّر بشأن مرئي في قناتك على الأمة الآن.',
    sign: 'الأمة الآن',
  },
} as const;

/** The creator-facing reason text, the same Studio shows ("Not approved: <reason>"). */
const REASONS = { en: STUDIO_EN.videos.review.reasons, ar: STUDIO_AR.videos.review.reasons } as const;

export interface RejectionEmailInput {
  to: string;
  name: string;
  locale: NotificationEmailLocale;
  videoId: string;
  title: string;
  reasonCode: string;
  /** Videos web origin; links are left out when unknown. */
  origin: string | null;
  environment?: string;
}

export function renderRejectionEmail(input: RejectionEmailInput): RenderedEmail {
  const s = COPY[input.locale];
  const reasons = REASONS[input.locale];
  const reason = isReviewReasonCode(input.reasonCode) ? reasons[input.reasonCode] : reasons.other;
  const studioUrl = input.origin ? `${input.origin}/${input.locale}/studio/video/${encodeURIComponent(input.videoId)}/edit` : null;
  const guidelinesUrl = input.origin ? `${input.origin}/${input.locale}/community-guidelines` : null;
  const settingsUrl = input.origin ? `${input.origin}/${input.locale}/settings#notifications` : null;
  const doc: EmailDoc = {
    locale: input.locale,
    subject: `${envTag(input.environment)}${s.subject}`,
    preheader: s.preheader,
    greeting: s.greeting(input.name),
    heading: s.heading,
    blocks: [
      { kind: 'p', text: s.intro(input.title) },
      { kind: 'facts', rows: [[s.reason, reason]] },
      { kind: 'p', text: s.next },
    ],
    ...(studioUrl ? { cta: { label: s.cta, url: studioUrl } } : {}),
    after: [
      ...(guidelinesUrl ? [{ kind: 'link' as const, label: s.guidelines, url: guidelinesUrl }] : []),
      ...(settingsUrl ? [{ kind: 'small' as const, text: s.settings }, { kind: 'link' as const, label: s.settingsLink, url: settingsUrl }] : []),
    ],
    signoff: s.sign,
    reason: s.footer,
    ...(input.origin ? { siteUrl: input.origin } : {}),
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

/** Needs-action item key of one rejection email ("review-rejection-email" retries it). */
export const rejectionMailItemKey = (reviewId: string) => `review-rejection-email:${reviewId}`.slice(0, 160);

/** Flags a final failure on the admin Errors page with Retry. Never throws. */
export async function flagRejectionMailFailure(env: AdminBindings, job: RejectionMailJob, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Video not approved email not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: rejectionMailItemKey(job.reviewId),
      source: 'email',
      title: 'Video not approved email not sent',
      itemType: 'review',
      itemId: job.reviewId,
      itemUrl: `/moderation/review/${encodeURIComponent(job.reviewId)}`,
      retry: { kind: 'builtin', handler: 'review-rejection-email', args: { id: job.reviewId, decidedAt: job.decidedAt, locale: job.adminLocale } },
      retryLabel: 'Resend email',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[RejectionMail] Could not flag the failure on the Errors page', { reviewId: job.reviewId, error: error instanceof Error ? error.message : String(error) });
  }
}

interface RejectedRow {
  id: string;
  subject_type: string;
  subject_id: string;
  owner_id: string | null;
  status: string;
  decision: string | null;
  decided_at: string | null;
  reason_code: string | null;
}

/** Still the rejection the job was queued for (not undone, not decided again)? */
export function stillRejected(row: RejectedRow | null, job: Pick<RejectionMailJob, 'decidedAt'>): row is RejectedRow & { owner_id: string } {
  return !!row && row.subject_type === 'video' && row.status === 'rejected' && row.decision === 'reject' && row.decided_at === job.decidedAt && !!row.owner_id;
}

type Outcome = 'done' | 'retry' | 'failed';
type MailEnv = AdminBindings & VideosClientEnv;

/** Sends one rejection email. Never throws; the caller acks or retries by the outcome. */
export async function processRejectionMailJob(env: MailEnv, msg: QueueMessageLike<RejectionMailJob>): Promise<Outcome> {
  const job = msg.body;
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[RejectionMail] Delivery failed for good', { alert: 'review_rejection_mail_failed', reviewId: job.reviewId, attempts: msg.attempts, reason });
    await flagRejectionMailFailure(env, job, reason);
    return 'failed';
  };
  try {
    if (job.v !== REJECTION_MAIL_VERSION || !job.reviewId || !job.decidedAt) {
      logger.error('[RejectionMail] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    const row = await env.REPORTS_DB.prepare('SELECT id, subject_type, subject_id, owner_id, status, decision, decided_at, reason_code FROM content_reviews WHERE id = ?')
      .bind(job.reviewId)
      .first<RejectedRow>();
    if (!stillRejected(row, job)) {
      logger.debug('[RejectionMail] Not sent: the rejection was undone or decided again', { reviewId: job.reviewId });
      return 'done';
    }

    let contact: AccountEmailContact;
    try {
      contact = await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(row.owner_id)}/account-email`);
    } catch (error) {
      // The profile is gone: there is no address to write to
      if (error instanceof VideosError && error.status === 404) return 'done';
      throw error;
    }
    // One language only: the creator's saved email language, else the rejecting admin's
    const decision = accountEmailDecision(contact, contact.savedLocale ?? (job.adminLocale === 'ar' ? 'ar' : 'en'));
    if ('status' in decision) {
      logger.debug('[RejectionMail] Not sent', { reviewId: job.reviewId, status: decision.status });
      return 'done';
    }
    const video = env.videos ? await (await env.videos.get(row.subject_id))?.json<{ title?: string }>() : null;
    const email = renderRejectionEmail({
      to: decision.to,
      name: contact.displayName,
      locale: decision.locale,
      videoId: row.subject_id,
      title: (video?.title ?? '').trim(),
      reasonCode: row.reason_code ?? 'other',
      origin: videosWebOrigin(env),
      environment: env.ENVIRONMENT,
    });
    const result = await sendContactEmail(env, email, { idempotencyKey: `review-rejected-${job.reviewId}-${job.decidedAt}` });
    if (result.status !== 'failed') return 'done';
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[RejectionMail] Send failed; will retry', { reviewId: job.reviewId, attempts: msg.attempts, error: result.error });
      return 'retry';
    }
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[RejectionMail] Job errored; will retry', { reviewId: job.reviewId, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    return await fail(reason);
  }
}
