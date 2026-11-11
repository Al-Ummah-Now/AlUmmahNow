/**
 * The account warning email (warn-user feature).
 *
 * Runs off the request path on the contact mail queue (CONTACT_MAIL_QUEUE,
 * lib/contact-mail-queue.ts routes `kind: 'warning'` jobs here) and sends
 * through the same Resend sender as Contact us (sendContactEmail).
 *
 * At send time it reads the user's address and email preferences from
 * api-videos (GET /internal/admin/users/:id/account-email), so a user who
 * turned "Email me about my account" off since the warning gets no email.
 * The email is in the language the user picked for emails (English until they
 * pick one). Failures worth retrying back off like contact mail; a final
 * failure is recorded on the warning and flagged on the admin Errors page
 * with Retry ("warning-email" in lib/errors-actions.ts).
 */
import {
  NOTIFICATION_CENTER_AR,
  NOTIFICATION_CENTER_EN,
  accountEmailDecision,
  newErrorRef,
  scrubEvent,
  type AccountEmailContact,
  type NotificationEmailLocale,
  type ReportReason,
} from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, VideosError, type VideosClientEnv } from './content/videosClient';
import { getWarning, recordWarningEmail } from './content/warnings';
import { escapeHtml, sendContactEmail, type RenderedEmail } from './contact-email';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { videosWebOrigin } from './invites';
import { logger } from './logger';

export const WARNING_MAIL_VERSION = 1;

export interface WarningMailJob {
  v: typeof WARNING_MAIL_VERSION;
  kind: 'warning';
  warningId: string;
}

export function isWarningMailJob(body: unknown): body is WarningMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'warning';
}

export const warningMailJob = (warningId: string): WarningMailJob => ({ v: WARNING_MAIL_VERSION, kind: 'warning', warningId });

/** Queues the email. False when the queue refused it (the caller records the failure). */
export async function enqueueWarningMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, warningId: string): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[WarningMail] CONTACT_MAIL_QUEUE is not bound');
    return false;
  }
  try {
    await env.CONTACT_MAIL_QUEUE.send(warningMailJob(warningId) as never, { contentType: 'json' });
    return true;
  } catch (error) {
    logger.error('[WarningMail] Enqueue failed', { warningId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const COPY = {
  en: {
    subject: 'Your Al Ummah Now account received a warning',
    greeting: (name: string) => (name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'),
    intro: 'Our moderators reviewed activity on your account and issued a warning.',
    reason: 'Reason',
    count: 'Warnings on your account',
    guidelines: 'Please read the community guidelines to keep your account in good standing:',
    repeat: 'Repeated warnings can lead to your account being suspended.',
    settings: 'You can turn these emails off in your notification settings:',
    sign: 'Al Ummah Now',
  },
  ar: {
    subject: 'تلقّى حسابك في الأمة الآن تحذيرًا',
    greeting: (name: string) => (name ? `السلام عليكم ${name}،` : 'السلام عليكم،'),
    intro: 'راجع المشرفون نشاط حسابك وأصدروا تحذيرًا.',
    reason: 'السبب',
    count: 'عدد التحذيرات على حسابك',
    guidelines: 'يُرجى قراءة إرشادات المجتمع للحفاظ على حسابك في وضع جيد:',
    repeat: 'قد يؤدي تكرار التحذيرات إلى إيقاف حسابك.',
    settings: 'يمكنك إيقاف هذه الرسائل من إعدادات الإشعارات:',
    sign: 'الأمة الآن',
  },
} as const;

const REASONS: Record<NotificationEmailLocale, Record<ReportReason, string>> = {
  en: NOTIFICATION_CENTER_EN.accountWarning.reasons,
  ar: NOTIFICATION_CENTER_AR.accountWarning.reasons,
};

/** Environment tag in subjects outside production, as contact mail does. */
const envTag = (environment: string | undefined) => (environment && environment !== 'production' ? `[${environment}] ` : '');

export interface WarningEmailInput {
  to: string;
  name: string;
  locale: NotificationEmailLocale;
  reasonCode: ReportReason;
  count: number;
  /** Videos web origin; links are left out when unknown. */
  origin: string | null;
  environment?: string;
}

/** The warning email in the user's language: reason in plain words, count, guidelines and settings links. */
export function renderWarningEmail(input: WarningEmailInput): RenderedEmail {
  const s = COPY[input.locale];
  const reason = REASONS[input.locale][input.reasonCode] ?? REASONS[input.locale].other;
  const count = input.count.toLocaleString(input.locale === 'ar' ? 'ar' : 'en');
  const guidelinesUrl = input.origin ? `${input.origin}/${input.locale}/community-guidelines` : null;
  const settingsUrl = input.origin ? `${input.origin}/${input.locale}/settings#notifications` : null;
  const text = [
    s.greeting(input.name),
    '',
    s.intro,
    '',
    `${s.reason}: ${reason}`,
    `${s.count}: ${count}`,
    '',
    guidelinesUrl ? `${s.guidelines}\n${guidelinesUrl}` : '',
    s.repeat,
    '',
    settingsUrl ? `${s.settings}\n${settingsUrl}` : '',
    '',
    `— ${s.sign}`,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
  const dir = input.locale === 'ar' ? 'rtl' : 'ltr';
  const link = (url: string) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const html = `<!doctype html><html lang="${input.locale}" dir="${dir}"><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.6">
<p>${escapeHtml(s.greeting(input.name))}</p>
<p>${escapeHtml(s.intro)}</p>
<p><strong>${escapeHtml(s.reason)}:</strong> ${escapeHtml(reason)}<br><strong>${escapeHtml(s.count)}:</strong> ${escapeHtml(count)}</p>
${guidelinesUrl ? `<p>${escapeHtml(s.guidelines)}<br>${link(guidelinesUrl)}</p>` : ''}
<p>${escapeHtml(s.repeat)}</p>
${settingsUrl ? `<p style="opacity:.75">${escapeHtml(s.settings)}<br>${link(settingsUrl)}</p>` : ''}
<p>— ${escapeHtml(s.sign)}</p>
</body></html>`;
  return { to: input.to, subject: `${envTag(input.environment)}${s.subject}`, text, html };
}

/** Needs-action item key of one warning email (lib/errors-actions.ts "warning-email" retries it). */
export const warningMailItemKey = (warningId: string) => `warning-email:${warningId}`.slice(0, 160);

/** Flags a final failure on the admin Errors page with Retry. Never throws. */
export async function flagWarningMailFailure(env: AdminBindings, warningId: string, userId: string, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Account warning email not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: warningMailItemKey(warningId),
      source: 'email',
      title: 'Account warning email not sent',
      itemType: 'user',
      itemId: userId,
      itemUrl: `/users/${encodeURIComponent(userId)}`,
      retry: { kind: 'builtin', handler: 'warning-email', args: { id: warningId } },
      retryLabel: 'Resend email',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[WarningMail] Could not flag the failure on the Errors page', { warningId, error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';
/** Email states after which a warning email is never sent again. */
const DONE = new Set(['sent', 'sunk', 'disabled', 'no_address']);

/** Sends one warning email. Never throws; the caller acks or retries by the outcome. */
export async function processWarningMailJob(
  env: AdminBindings & VideosClientEnv,
  msg: QueueMessageLike<WarningMailJob>,
  now = () => new Date(),
): Promise<Outcome> {
  const { warningId } = msg.body;
  const db = env.REPORTS_DB;
  let userId = '';
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[WarningMail] Delivery failed for good', { alert: 'warning_mail_failed', warningId, attempts: msg.attempts, reason });
    await recordWarningEmail(db, warningId, 'failed', { error: reason, now: now() });
    if (userId) await flagWarningMailFailure(env, warningId, userId, reason);
    return 'failed';
  };
  try {
    if (msg.body.v !== WARNING_MAIL_VERSION || !warningId) {
      logger.error('[WarningMail] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    const warning = await getWarning(db, warningId);
    if (!warning) return 'done';
    userId = warning.user_id;
    if (warning.email_status && DONE.has(warning.email_status)) return 'done';

    let contact: AccountEmailContact;
    try {
      contact = await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(warning.user_id)}/account-email`);
    } catch (error) {
      // The profile is gone: there is no address to write to
      if (error instanceof VideosError && error.status === 404) {
        await recordWarningEmail(db, warningId, 'no_address', { now: now() });
        return 'done';
      }
      throw error;
    }
    const decision = accountEmailDecision(contact);
    if ('status' in decision) {
      await recordWarningEmail(db, warningId, decision.status, { now: now() });
      logger.debug('[WarningMail] Not sent', { warningId, status: decision.status });
      return 'done';
    }
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM user_warnings WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?))')
      .bind(warning.user_id, warning.created_at, warning.created_at, warning.id)
      .first<{ n: number }>();
    const email = renderWarningEmail({
      to: decision.to,
      name: contact.displayName,
      locale: decision.locale,
      reasonCode: warning.reason_code as ReportReason,
      count: Number(count?.n ?? 1),
      origin: videosWebOrigin(env),
      environment: env.ENVIRONMENT,
    });
    const result = await sendContactEmail(env, email, { idempotencyKey: `warning-${warningId}` });
    if (result.status !== 'failed') {
      await recordWarningEmail(db, warningId, result.status === 'sunk' ? 'sunk' : 'sent', { now: now() });
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[WarningMail] Send failed; will retry', { warningId, attempts: msg.attempts, error: result.error });
      return 'retry';
    }
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[WarningMail] Job errored; will retry', { warningId, attempts: msg.attempts, error: reason });
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
