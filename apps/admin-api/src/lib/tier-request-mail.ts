/**
 * Delivery of a tier request decision (wiki AUN-TIER-REQUESTS): the in-app
 * notice and the email, in one queued job.
 *
 * Runs on the contact mail queue (CONTACT_MAIL_QUEUE; lib/contact-mail-queue.ts
 * routes `kind: 'tier_request'` here), so it shares its retries with back-off
 * and its DLQ. Both steps are idempotent, so a retry after a partial failure
 * neither notifies twice nor emails twice:
 *
 * 1. In-app: api-videos POST /internal/admin/tier-requests/:id/notify queues
 *    the notice with a dedupe key per decision (the processor stores it once).
 * 2. Email: skipped once it is sent, sunk or not wanted (the user's "Email me
 *    about my account" preference, read at send time); Resend gets an
 *    Idempotency-Key per decision. Language: the user's email language, else
 *    English. The outcome is stored on the request (the admin queue shows it).
 *
 * The job carries the decision's timestamp: a retry for a request decided again
 * since does nothing. A final failure flags the admin Errors page with Retry
 * ("tier-request-delivery" in lib/errors-actions.ts).
 */
import { accountEmailDecision, newErrorRef, scrubEvent, toPublicTier, type AccountEmailContact, type CreatorTier, type NotificationEmailLocale } from '@al-ummah/shared-types';
import { tierAllowsFacts } from './tier-change-mail';
import type { AdminBindings } from '../base/types';
import { callVideos, VideosError, type VideosClientEnv } from './content/videosClient';
import { envTag, sendContactEmail, type RenderedEmail } from './contact-email';
import { renderEmail, type EmailDoc } from './email/layout';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { videosWebOrigin } from './invites';
import { logger } from './logger';

export const TIER_REQUEST_MAIL_VERSION = 1;

export interface TierRequestMailJob {
  v: typeof TIER_REQUEST_MAIL_VERSION;
  kind: 'tier_request';
  requestId: string;
  /** The decision this job delivers (a request decided again since is not this decision) */
  decidedAt: string;
}

export function isTierRequestMailJob(body: unknown): body is TierRequestMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'tier_request';
}

export const tierRequestMailJob = (requestId: string, decidedAt: string): TierRequestMailJob => ({ v: TIER_REQUEST_MAIL_VERSION, kind: 'tier_request', requestId, decidedAt });

/** Queues the delivery. False when the queue refused it (the caller flags the failure). */
export async function enqueueTierRequestMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, job: TierRequestMailJob): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[TierRequestMail] CONTACT_MAIL_QUEUE is not bound');
    return false;
  }
  try {
    await env.CONTACT_MAIL_QUEUE.send(job as never, { contentType: 'json' });
    return true;
  } catch (error) {
    logger.error('[TierRequestMail] Enqueue failed', { requestId: job.requestId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** The request as api-videos returns it to the admin (GET /internal/admin/tier-requests/:id). */
export interface DecidedRequest {
  id: string;
  userId: string;
  tierId: string;
  tierName: string;
  /** The tier the user held when asking */
  fromTierId?: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  declineReason: string | null;
  decidedAt: string | null;
  emailStatus: string | null;
}

const COPY = {
  en: {
    approved: {
      subject: (tier: string) => `Your request for ${tier} was approved`,
      heading: 'Your request was approved',
      intro: (tier: string) => `Your account now has the ${tier} tier on Al Ummah Now.`,
      next: 'What it includes is on the Upgrade page. If it includes uploading, you can start now.',
      cta: 'See your tier',
      preheader: (tier: string) => `You now have the ${tier} tier.`,
    },
    declined: {
      subject: (tier: string) => `About your request for ${tier}`,
      heading: 'Your request was not approved this time',
      intro: (tier: string) => `Thank you for asking for the ${tier} tier. During the beta we grant tiers one request at a time, and we could not approve this one.`,
      next: 'You can send a new request from the Upgrade page.',
      cta: 'Open the Upgrade page',
      preheader: (_tier: string) => 'You can send a new request from the Upgrade page.',
    },
    reason: 'Note from the team',
    tier: 'Tier',
    before: 'Before',
    includes: 'What it now includes:',
    greeting: (name: string) => (name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'),
    settings: 'You can turn these emails off in your notification settings:',
    settingsLink: 'Notification settings',
    footer: 'You received this email because you requested a tier on Al Ummah Now.',
    sign: 'Al Ummah Now',
  },
  ar: {
    approved: {
      subject: (tier: string) => `تمت الموافقة على طلبك للحصول على ${tier}`,
      heading: 'تمت الموافقة على طلبك',
      intro: (tier: string) => `أصبحت لحسابك في الأمة الآن فئة ${tier}.`,
      next: 'تجد ما يتضمنه في صفحة الترقية. وإن كان يتضمن الرفع فيمكنك البدء الآن.',
      cta: 'اطّلع على فئتك',
      preheader: (tier: string) => `أصبحت لديك فئة ${tier}.`,
    },
    declined: {
      subject: (tier: string) => `بخصوص طلبك للحصول على ${tier}`,
      heading: 'لم تتم الموافقة على طلبك هذه المرة',
      intro: (tier: string) => `شكرًا لطلبك فئة ${tier}. نمنح الفئات خلال المرحلة التجريبية بمراجعة كل طلب على حدة، ولم نتمكن من الموافقة على هذا الطلب.`,
      next: 'يمكنك إرسال طلب جديد من صفحة الترقية.',
      cta: 'افتح صفحة الترقية',
      preheader: (_tier: string) => 'يمكنك إرسال طلب جديد من صفحة الترقية.',
    },
    reason: 'ملاحظة من الفريق',
    tier: 'الفئة',
    before: 'قبل',
    includes: 'ما تشمله الآن:',
    greeting: (name: string) => (name ? `السلام عليكم ${name}،` : 'السلام عليكم،'),
    settings: 'يمكنك إيقاف هذه الرسائل من إعدادات الإشعارات:',
    settingsLink: 'إعدادات الإشعارات',
    footer: 'وصلتك هذه الرسالة لأنك طلبت فئة في الأمة الآن.',
    sign: 'الأمة الآن',
  },
} as const;

export interface TierRequestEmailInput {
  to: string;
  name: string;
  locale: NotificationEmailLocale;
  approved: boolean;
  tierName: string;
  reason: string | null;
  origin: string | null;
  environment?: string;
  /** Approved: the tier before (old → new) and what the new tier allows (lib/tier-change-mail.ts) */
  fromTierName?: string | null;
  allows?: [string, string][];
}

/** The decision email in one language on the shared branded layout (lib/email/layout.ts). */
export function renderTierRequestEmail(input: TierRequestEmailInput): RenderedEmail {
  const s = COPY[input.locale];
  const d = input.approved ? s.approved : s.declined;
  const upgradeUrl = input.origin ? `${input.origin}/${input.locale}/upgrade` : null;
  const settingsUrl = input.origin ? `${input.origin}/${input.locale}/settings#notifications` : null;
  const doc: EmailDoc = {
    locale: input.locale,
    subject: `${envTag(input.environment)}${d.subject(input.tierName)}`,
    preheader: d.preheader(input.tierName),
    greeting: s.greeting(input.name),
    heading: d.heading,
    blocks: [
      { kind: 'p', text: d.intro(input.tierName) },
      { kind: 'facts', rows: input.approved && input.fromTierName ? [[s.before, input.fromTierName], [s.tier, input.tierName]] : [[s.tier, input.tierName]] },
      ...(input.approved && input.allows?.length ? [{ kind: 'p' as const, text: s.includes }, { kind: 'facts' as const, rows: input.allows }] : []),
      ...(input.reason ? [{ kind: 'notice' as const, text: `${s.reason}: ${input.reason}`, tone: 'info' as const }] : []),
      { kind: 'p', text: d.next },
    ],
    ...(upgradeUrl ? { cta: { label: d.cta, url: upgradeUrl } } : {}),
    after: settingsUrl ? [{ kind: 'small', text: s.settings }, { kind: 'link', label: s.settingsLink, url: settingsUrl }] : [],
    signoff: s.sign,
    reason: s.footer,
    ...(input.origin ? { siteUrl: input.origin } : {}),
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

/** Needs-action item key of one decision's delivery. */
export const tierRequestItemKey = (requestId: string) => `tier-request:${requestId}`.slice(0, 160);

/** Flags a final failure on the admin Errors page with Retry. Never throws. */
export async function flagTierRequestFailure(env: AdminBindings, job: Pick<TierRequestMailJob, 'requestId' | 'decidedAt'>, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Tier request decision not delivered: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: tierRequestItemKey(job.requestId),
      source: 'email',
      title: 'Tier request decision not delivered',
      itemType: 'tier-request',
      itemId: job.requestId,
      itemUrl: `/tier-requests?request=${encodeURIComponent(job.requestId)}`,
      retry: { kind: 'builtin', handler: 'tier-request-delivery', args: { id: job.requestId, decidedAt: job.decidedAt } },
      retryLabel: 'Deliver again',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[TierRequestMail] Could not flag the failure on the Errors page', { requestId: job.requestId, error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';
/** Email states after which a decision email is never sent again. */
const DONE = new Set(['sent', 'sunk', 'disabled', 'no_address']);

const record = (env: VideosClientEnv, id: string, update: Record<string, unknown>) =>
  callVideos(env, `/tier-requests/${encodeURIComponent(id)}/delivery`, { method: 'POST', json: update });

/** Delivers one decision. Never throws; the caller acks or retries by the outcome. */
export async function processTierRequestMailJob(env: AdminBindings & VideosClientEnv, msg: QueueMessageLike<TierRequestMailJob>): Promise<Outcome> {
  const { requestId, decidedAt } = msg.body;
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[TierRequestMail] Delivery failed for good', { alert: 'tier_request_delivery_failed', requestId, attempts: msg.attempts, reason });
    await record(env, requestId, { emailStatus: 'failed', emailError: reason.slice(0, 500) }).catch(() => undefined);
    await flagTierRequestFailure(env, { requestId, decidedAt }, reason);
    return 'failed';
  };
  try {
    if (msg.body.v !== TIER_REQUEST_MAIL_VERSION || !requestId || !decidedAt) {
      logger.error('[TierRequestMail] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    let request: DecidedRequest;
    try {
      request = (await callVideos<{ request: DecidedRequest }>(env, `/tier-requests/${encodeURIComponent(requestId)}`)).request;
    } catch (error) {
      if (error instanceof VideosError && error.status === 404) return 'done';
      throw error;
    }
    // Not this decision any more (or never decided): nothing to deliver
    if ((request.status !== 'approved' && request.status !== 'declined') || request.decidedAt !== decidedAt) return 'done';

    // 1. In-app notice (deduplicated per decision by the processor)
    await callVideos(env, `/tier-requests/${encodeURIComponent(requestId)}/notify`, { method: 'POST', json: {} });

    // 2. Email, once
    if (request.emailStatus && DONE.has(request.emailStatus)) return 'done';
    let contact: AccountEmailContact;
    try {
      contact = await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(request.userId)}/account-email`);
    } catch (error) {
      if (error instanceof VideosError && error.status === 404) {
        await record(env, requestId, { emailStatus: 'no_address' });
        return 'done';
      }
      throw error;
    }
    const decision = accountEmailDecision(contact);
    if ('status' in decision) {
      await record(env, requestId, { emailStatus: decision.status });
      return 'done';
    }
    // Approved: old → new and what the new tier allows (as every tier-change email says)
    let fromTierName: string | null = null;
    let allows: [string, string][] = [];
    if (request.status === 'approved') {
      const tiers = (await callVideos<{ items?: CreatorTier[] }>(env, '/creator-tiers', { query: { counts: '0' } }).catch(() => ({ items: [] as CreatorTier[] }))).items ?? [];
      const nameOf = (t: CreatorTier | undefined) => (t ? (decision.locale === 'ar' ? t.nameAr || t.name : t.name) : null);
      fromTierName = nameOf(tiers.find((t) => t.id === request.fromTierId));
      const to = tiers.find((t) => t.id === request.tierId);
      allows = tierAllowsFacts(to ? toPublicTier(to) : null, decision.locale);
    }
    const email = renderTierRequestEmail({
      fromTierName,
      allows,
      to: decision.to,
      name: contact.displayName,
      locale: decision.locale,
      approved: request.status === 'approved',
      tierName: request.tierName,
      reason: request.status === 'declined' ? request.declineReason : null,
      origin: videosWebOrigin(env),
      environment: env.ENVIRONMENT,
    });
    const result = await sendContactEmail(env, email, { idempotencyKey: `tier-request-${requestId}-${decidedAt}` });
    if (result.status !== 'failed') {
      await record(env, requestId, { emailStatus: result.status === 'sunk' ? 'sunk' : 'sent' });
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[TierRequestMail] Send failed; will retry', { requestId, attempts: msg.attempts, error: result.error });
      return 'retry';
    }
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[TierRequestMail] Job errored; will retry', { requestId, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    return fail(reason);
  }
}
