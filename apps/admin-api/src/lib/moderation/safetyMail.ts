/**
 * Emails about the child safety and CSAM case items of the Errors page (isChildSafetyErrorKey): to each super admin of
 * the staff list (admin_staff), never to the shared error address or the support inbox.
 *
 * One email per item when it is new or comes back, in the recipient's saved email language (else English). It says what
 * kind of thing needs them and links to the admin, where only a super admin sees it: no title, text, name or id of what
 * was reported. Production only, at most SAFETY_MAIL_PER_HOUR items an hour (the rest stay on the Errors page).
 *
 * Delivered by the contact mail queue (`kind: 'safety_alert'`), with its retries; inline when the queue refuses.
 */
import type { AccountEmailContact } from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { listActiveStaff } from '../admin-staff';
import { callVideos, VideosError, type VideosClientEnv } from '../content/videosClient';
import { sendContactEmail, type RenderedEmail } from '../contact-email';
import type { QueueMessageLike } from '../contact-mail-queue';
import { renderEmail, type EmailLocale } from '../email/layout';
import { bumpRate, recordAlert } from '../errors-store';
import { logger } from '../logger';
import type { D1Database } from '../types';

export const SAFETY_MAIL_VERSION = 1;
export const SAFETY_MAIL_PER_HOUR = 20;
/** Keep equal to contact-mail-queue.ts MAX_ATTEMPTS. */
const MAX_ATTEMPTS = 6;

export type SafetyTopic = 'report' | 'record' | 'retention' | 'case';

/** An item that is new or came back (errors-store.ts ingestErrorEvents). */
export interface SafetyItem {
  groupId: string;
  key: string;
  itemUrl: string | null;
}

export interface SafetyMailJob {
  v: typeof SAFETY_MAIL_VERSION;
  kind: 'safety_alert';
  /** One per alert: a retried job sends nobody a second copy */
  id: string;
  groupId: string;
  topic: SafetyTopic;
  path: string;
}

export type SafetyMailEnv = AdminBindings & VideosClientEnv;

export const isSafetyMailJob = (body: unknown): body is SafetyMailJob => (body as { kind?: unknown } | null | undefined)?.kind === 'safety_alert';

export function safetyTopic(key: string): SafetyTopic {
  if (/^child-safety-reports?:/.test(key)) return 'report';
  if (key.startsWith('child-safety-evidence:')) return 'record';
  if (key.startsWith('child-safety-')) return 'retention';
  return 'case';
}

const COPY = {
  en: {
    report: 'A child safety report needs review',
    record: 'The record of a reported item could not be kept',
    retention: 'Kept records past their time could not be deleted',
    case: 'A child safety case needs you',
    body: 'The details are in the videos admin, for super admins only.',
    cta: 'Open in the admin',
    reason: 'You received this email because you are a super admin of Al Ummah Now videos.',
    sign: 'Al Ummah Now',
  },
  ar: {
    report: 'بلاغ عن سلامة الأطفال ينتظر المراجعة',
    record: 'تعذّر حفظ سجل محتوى مُبلَّغ عنه',
    retention: 'تعذّر حذف سجلات محفوظة انتهت مدتها',
    case: 'حالة تتعلق بسلامة الأطفال تحتاج إليك',
    body: 'التفاصيل في لوحة إدارة المرئيات، للمشرفين الأعلى وحدهم.',
    cta: 'افتح لوحة الإدارة',
    reason: 'وصلتك هذه الرسالة لأنك مشرف أعلى في مرئيات الأمة الآن.',
    sign: 'الأمة الآن',
  },
} as const;

export function renderSafetyEmail(input: { to: string; locale: EmailLocale; topic: SafetyTopic; path: string; adminUrl?: string }): RenderedEmail {
  const c = COPY[input.locale];
  const { subject, html, text } = renderEmail({
    locale: input.locale,
    subject: c[input.topic],
    preheader: c.body,
    heading: c[input.topic],
    blocks: [{ kind: 'p', text: c.body }],
    ...(input.adminUrl ? { cta: { label: c.cta, url: `${input.adminUrl.replace(/\/$/, '')}${input.path}` } } : {}),
    signoff: c.sign,
    reason: c.reason,
  });
  return { to: input.to, subject, html, text };
}

/** Queues the emails of the items a batch raised. Never throws: the items are on the Errors page either way. */
export async function sendSafetyAlerts(env: SafetyMailEnv, items: SafetyItem[], now = new Date()): Promise<number> {
  if (env.ENVIRONMENT !== 'production') return 0;
  const db = env.REPORTS_DB as unknown as D1Database;
  let queued = 0;
  for (const item of items) {
    try {
      if ((await bumpRate(db, `safety-alert:${now.toISOString().slice(0, 13)}`, new Date(now.getTime() + 2 * 3_600_000))) > SAFETY_MAIL_PER_HOUR) {
        await recordAlert(db, item.groupId, 'Alert not mailed to super admins (hourly limit)', now);
        continue;
      }
      // A path of the admin, or the item's Errors page
      const path = item.itemUrl && /^\/(?!\/)/.test(item.itemUrl) ? item.itemUrl : `/errors/${encodeURIComponent(item.groupId)}`;
      const job: SafetyMailJob = { v: SAFETY_MAIL_VERSION, kind: 'safety_alert', id: crypto.randomUUID(), groupId: item.groupId, topic: safetyTopic(item.key), path };
      try {
        if (!env.CONTACT_MAIL_QUEUE) throw new Error('CONTACT_MAIL_QUEUE is not bound');
        await env.CONTACT_MAIL_QUEUE.send(job as never, { contentType: 'json' });
      } catch (error) {
        logger.error('[SafetyMail] Not queued; sent now', { groupId: item.groupId, error: error instanceof Error ? error.message : String(error) });
        await processSafetyMailJob(env, { id: job.id, body: job, attempts: MAX_ATTEMPTS, ack() {}, retry() {} });
      }
      queued++;
    } catch (error) {
      logger.error('[SafetyMail] Alert failed', { groupId: item.groupId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return queued;
}

/** Emails every super admin of the staff list as it is now. 'retry' when somebody could not be reached for now. */
export async function processSafetyMailJob(env: SafetyMailEnv, msg: QueueMessageLike<SafetyMailJob>, opts: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<'done' | 'retry' | 'failed'> {
  const job = msg.body;
  if (job.v !== SAFETY_MAIL_VERSION || !job.id) return 'done';
  const db = env.REPORTS_DB as unknown as D1Database;
  const now = opts.now ?? new Date();
  const last = msg.attempts >= MAX_ATTEMPTS;
  let sent = 0;
  let later = 0;
  let refused = 0;
  try {
    const staff = await listActiveStaff(db, ['super_admin']);
    for (const person of staff) {
      try {
        const contact = await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(person.user_id)}/account-email`).catch((error) => {
          if (error instanceof VideosError && error.status === 404) return null;
          throw error;
        });
        const to = contact?.email?.trim();
        if (!to || !to.includes('@')) continue;
        const email = renderSafetyEmail({ to, locale: contact!.locale === 'ar' ? 'ar' : 'en', topic: job.topic, path: job.path, adminUrl: env.ADMIN_WEB_URL });
        const result = await sendContactEmail(env as never, email, { idempotencyKey: `safety-alert-${job.id}-${person.user_id}`, fetchImpl: opts.fetchImpl });
        if (result.status !== 'failed') sent++;
        else if (result.retryable) later++;
        else refused++;
      } catch (error) {
        logger.warn('[SafetyMail] A super admin could not be reached yet', { alert: job.id, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
        later++;
      }
    }
    if (later > 0 && !last) return 'retry';
    const failed = later + refused;
    await recordAlert(db, job.groupId, `Alert to super admins: ${sent} sent${failed ? `, ${failed} failed` : ''}`, now).catch((error) => logger.warn('[SafetyMail] Not noted on the Errors page', { groupId: job.groupId, error: String(error) }));
    if (sent > 0 && failed === 0) return 'done';
    logger.error('[SafetyMail] Not every super admin was mailed', { alert: 'safety_mail_failed', id: job.id, sent, failed, staff: staff.length });
    return failed > 0 ? 'failed' : 'done';
  } catch (error) {
    logger.error('[SafetyMail] Delivery failed', { alert: job.id, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
    return last ? 'failed' : 'retry';
  }
}
