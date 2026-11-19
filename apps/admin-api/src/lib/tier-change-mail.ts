/**
 * The tier-change email (wiki AUN-TIER-REQUESTS "Telling the user"): api-videos
 * stores every change of a user's tier (lib/tierChanges.ts), sends the in-app
 * notice and queues `{ kind: 'tier_changed', changeId }` on the contact mail
 * queue, which routes it here. One language, picked at send time (the user's
 * email language, else English), on the shared branded layout; old → new tier
 * and what the new tier allows; a link to /upgrade. Sent once (Resend
 * Idempotency-Key per change; a stored final state is never sent again); a
 * final failure flags the admin Errors page with Retry.
 */
import { accountEmailDecision, formatInteger, newErrorRef, scrubEvent, type AccountEmailContact, type NotificationEmailLocale, type PublicTier, type TierChange } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, VideosError, type VideosClientEnv } from './content/videosClient';
import { envTag, sendContactEmail, type RenderedEmail } from './contact-email';
import { renderEmail, type EmailDoc } from './email/layout';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { videosWebOrigin } from './invites';
import { logger } from './logger';

export const TIER_CHANGE_MAIL_VERSION = 1;

export interface TierChangeMailJob {
  v: typeof TIER_CHANGE_MAIL_VERSION;
  kind: 'tier_changed';
  changeId: string;
}

export function isTierChangeMailJob(body: unknown): body is TierChangeMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'tier_changed';
}

const fmt = (n: number, locale: NotificationEmailLocale) => formatInteger(locale, n);

/** What a tier allows, as label/value rows (also used by the approved-request email). */
export function tierAllowsFacts(tier: PublicTier | null, locale: NotificationEmailLocale): [string, string][] {
  if (!tier) return [];
  const ar = locale === 'ar';
  const rows: [string, string][] = [];
  rows.push([ar ? 'الرفع' : 'Uploads', !tier.uploads ? (ar ? 'لا' : 'No') : tier.uploadsPerDay === null ? (ar ? 'دون حد يومي' : 'No daily limit') : ar ? `حتى ${fmt(tier.uploadsPerDay, locale)} مرئي يوميًا` : `Up to ${fmt(tier.uploadsPerDay, locale)} videos a day`]);
  rows.push([ar ? 'القنوات' : 'Channels', !tier.channels ? (ar ? 'لا' : 'No') : tier.maxChannels === null ? (ar ? 'أي عدد' : 'Any number') : ar ? `حتى ${fmt(tier.maxChannels, locale)}` : `Up to ${fmt(tier.maxChannels, locale)}`]);
  rows.push([ar ? 'دقائق الترجمة النصية' : 'Caption minutes', tier.unlimited ? (ar ? 'دون حد شهري' : 'No monthly limit') : tier.captionMinutesMonth > 0 ? (ar ? `${fmt(tier.captionMinutesMonth, locale)} شهريًا` : `${fmt(tier.captionMinutesMonth, locale)} a month`) : ar ? 'لا' : 'None']);
  return rows;
}

const COPY = {
  en: {
    subject: (to: string) => `Your tier is now ${to}`,
    preheader: (from: string, to: string) => `Your tier changed from ${from} to ${to}.`,
    heading: 'Your tier changed',
    intro: (from: string, to: string) => `Your tier on Al Ummah Now changed from ${from} to ${to}.`,
    why: { admin: 'Our team changed it.', subscription: 'Your subscription changed it.', request: 'Your request was approved.' },
    from: 'Before',
    to: 'Now',
    includes: 'What it now includes:',
    cta: 'Open the Upgrade page',
    greeting: (name: string) => (name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'),
    settings: 'You can turn these emails off in your notification settings:',
    settingsLink: 'Notification settings',
    footer: 'You received this email because your tier on Al Ummah Now changed.',
    sign: 'Al Ummah Now',
  },
  ar: {
    subject: (to: string) => `أصبحت فئتك ${to}`,
    preheader: (from: string, to: string) => `تغيّرت فئتك من ${from} إلى ${to}.`,
    heading: 'تغيّرت فئتك',
    intro: (from: string, to: string) => `تغيّرت فئتك في الأمة الآن من ${from} إلى ${to}.`,
    why: { admin: 'غيّرها فريقنا.', subscription: 'غيّرها اشتراكك.', request: 'تمت الموافقة على طلبك.' },
    from: 'قبل',
    to: 'الآن',
    includes: 'ما تشمله الآن:',
    cta: 'افتح صفحة الترقية',
    greeting: (name: string) => (name ? `السلام عليكم ${name}،` : 'السلام عليكم،'),
    settings: 'يمكنك إيقاف هذه الرسائل من إعدادات الإشعارات:',
    settingsLink: 'إعدادات الإشعارات',
    footer: 'وصلتك هذه الرسالة لأن فئتك في الأمة الآن تغيّرت.',
    sign: 'الأمة الآن',
  },
} as const;

export interface TierChangeEmailInput {
  to: string;
  name: string;
  locale: NotificationEmailLocale;
  change: Pick<TierChange, 'reason' | 'fromTierName' | 'fromTierNameAr' | 'toTierName' | 'toTierNameAr' | 'toTier'>;
  origin: string | null;
  environment?: string;
}

/** The tier-change email in one language on the shared branded layout. */
export function renderTierChangeEmail(input: TierChangeEmailInput): RenderedEmail {
  const s = COPY[input.locale];
  const from = input.locale === 'ar' ? input.change.fromTierNameAr : input.change.fromTierName;
  const to = input.locale === 'ar' ? input.change.toTierNameAr : input.change.toTierName;
  const upgradeUrl = input.origin ? `${input.origin}/${input.locale}/upgrade` : null;
  const settingsUrl = input.origin ? `${input.origin}/${input.locale}/settings#notifications` : null;
  const allows = tierAllowsFacts(input.change.toTier, input.locale);
  const doc: EmailDoc = {
    locale: input.locale,
    subject: `${envTag(input.environment)}${s.subject(to)}`,
    preheader: s.preheader(from, to),
    greeting: s.greeting(input.name),
    heading: s.heading,
    blocks: [
      { kind: 'p', text: `${s.intro(from, to)} ${s.why[input.change.reason]}` },
      { kind: 'facts', rows: [[s.from, from], [s.to, to]] },
      ...(allows.length ? [{ kind: 'p' as const, text: s.includes }, { kind: 'facts' as const, rows: allows }] : []),
    ],
    ...(upgradeUrl ? { cta: { label: s.cta, url: upgradeUrl } } : {}),
    after: settingsUrl ? [{ kind: 'small', text: s.settings }, { kind: 'link', label: s.settingsLink, url: settingsUrl }] : [],
    signoff: s.sign,
    reason: s.footer,
    ...(input.origin ? { siteUrl: input.origin } : {}),
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

/** Queues the email again (the Errors page's Retry). */
export async function enqueueTierChangeMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, changeId: string): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) return false;
  try {
    await env.CONTACT_MAIL_QUEUE.send({ v: TIER_CHANGE_MAIL_VERSION, kind: 'tier_changed', changeId } as never, { contentType: 'json' });
    return true;
  } catch (error) {
    logger.error('[TierChangeMail] Enqueue failed', { changeId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function flagFailure(env: AdminBindings, changeId: string, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Tier change email not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: `tier-change:${changeId}`.slice(0, 160),
      source: 'email',
      title: 'Tier change email not sent',
      itemType: 'tier-change',
      itemId: changeId,
      retry: { kind: 'builtin', handler: 'tier-change-delivery', args: { id: changeId } },
      retryLabel: 'Send again',
    },
  });
  if (!event) return;
  try {
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[TierChangeMail] Could not flag the failure on the Errors page', { changeId, error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';
const DONE = new Set(['sent', 'sunk', 'disabled', 'no_address']);
const record = (env: VideosClientEnv, id: string, update: { emailStatus: string; emailError?: string | null }) =>
  callVideos(env, `/tier-changes/${encodeURIComponent(id)}/delivery`, { method: 'POST', json: update });

/** Sends one tier-change email. Never throws; the caller acks or retries by the outcome. */
export async function processTierChangeMailJob(env: AdminBindings & VideosClientEnv, msg: QueueMessageLike<TierChangeMailJob>): Promise<Outcome> {
  const { changeId } = msg.body;
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[TierChangeMail] Email failed for good', { alert: 'tier_change_email_failed', changeId, attempts: msg.attempts, reason });
    await record(env, changeId, { emailStatus: 'failed', emailError: reason.slice(0, 500) }).catch(() => undefined);
    await flagFailure(env, changeId, reason);
    return 'failed';
  };
  try {
    if (msg.body.v !== TIER_CHANGE_MAIL_VERSION || !changeId) {
      logger.error('[TierChangeMail] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    let change: TierChange;
    try {
      change = (await callVideos<{ change: TierChange }>(env, `/tier-changes/${encodeURIComponent(changeId)}`)).change;
    } catch (error) {
      if (error instanceof VideosError && error.status === 404) return 'done';
      throw error;
    }
    if (change.emailStatus && DONE.has(change.emailStatus)) return 'done';
    let contact: AccountEmailContact;
    try {
      contact = await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(change.userId)}/account-email`);
    } catch (error) {
      if (error instanceof VideosError && error.status === 404) {
        await record(env, changeId, { emailStatus: 'no_address' });
        return 'done';
      }
      throw error;
    }
    const decision = accountEmailDecision(contact);
    if ('status' in decision) {
      await record(env, changeId, { emailStatus: decision.status });
      return 'done';
    }
    const email = renderTierChangeEmail({ to: decision.to, name: contact.displayName, locale: decision.locale, change, origin: videosWebOrigin(env), environment: env.ENVIRONMENT });
    const result = await sendContactEmail(env, email, { idempotencyKey: `tier-change-${changeId}` });
    if (result.status !== 'failed') {
      await record(env, changeId, { emailStatus: result.status === 'sunk' ? 'sunk' : 'sent' });
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) return 'retry';
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[TierChangeMail] Job errored; will retry', { changeId, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    return fail(reason);
  }
}
