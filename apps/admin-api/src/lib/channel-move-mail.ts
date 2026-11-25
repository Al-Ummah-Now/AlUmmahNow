/**
 * The emails of a channel move (wiki AUN-CHANNEL-CLAIM §3.6, §5, CC-7c): the receiver when an owner
 * offers them the channel, and both owners when a channel moved, by its owner or by the team.
 * api-videos queues `{ kind: 'channel_move', event, id }` on the contact mail queue, which routes it
 * here; what the email says is read from api-videos when it is sent, so one that no longer applies (an
 * offer answered meanwhile) is not sent. One language, picked at send time (the person's email
 * language, else English), on the shared branded layout.
 *
 * An owner is always told that their channel moved (CC-D11), whatever their email setting; an offer
 * follows "Email me about my account". Sent once (Resend Idempotency-Key per event and id; api-videos keeps
 * that it was sent, so a later Retry sends nothing); a final failure is on the admin Errors page with Retry
 * ("channel-move-mail" in lib/errors-actions.ts).
 */
import { accountEmailDecision, newErrorRef, scrubEvent, stripBidiControls, type AccountEmailContact, type ChannelMoveMail, type ChannelMoveMailEvent, type ChannelMoveMailJob, type NotificationEmailLocale } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, VideosError, type VideosClientEnv } from './content/videosClient';
import { envTag, sendContactEmail, type RenderedEmail } from './contact-email';
import { formatEmailDate, renderEmail, type EmailBlock, type EmailDoc } from './email/layout';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { videosWebOrigin } from './invites';
import { logger } from './logger';

export function isChannelMoveMailJob(body: unknown): body is ChannelMoveMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'channel_move';
}

const COPY = {
  en: {
    someone: 'Someone',
    channel: 'your channel',
    newChannel: 'a channel',
    greeting: (name: string) => (name ? `Assalamu alaikum ${name},` : 'Assalamu alaikum,'),
    offered: {
      subject: (channel: string, who: string) => `${who} offered you ${channel}`,
      preheader: 'Accept or decline the offer.',
      heading: 'A channel was offered to you',
      intro: (channel: string, who: string) => `${who} wants to hand ${channel} over to you.`,
      what: 'If you accept, you become the owner of the channel, its videos, playlists and posts.',
      contactKept: 'Its public contact email stays.',
      until: (date: string) => `The offer is open until ${date}.`,
      cta: 'View offer',
      unexpected: 'Nothing changes unless you accept.',
      footer: 'You received this email because a channel was offered to your Al Ummah Now account.',
    },
    moved_in: {
      subject: (channel: string) => `You are now the owner of ${channel}`,
      preheader: 'The channel is yours.',
      heading: 'You own a new channel',
      own: (channel: string, who: string) => `The move from ${who} is done, and you are now the owner of ${channel}.`,
      team: (channel: string) => `The Al Ummah Now team moved ${channel} to your account. You are now its owner.`,
      what: 'Its videos, playlists and posts are yours too. Live stream keys were replaced.',
      cta: 'Open the channel',
      footer: 'You received this email because a channel was moved to your Al Ummah Now account.',
    },
    moved_out: {
      subject: (channel: string) => `${channel} moved to another account`,
      preheader: 'You are no longer its owner.',
      heading: 'Your channel moved',
      own: (channel: string, who: string) => `${who} accepted your offer, and ${channel} is now theirs.`,
      team: (channel: string) => `The Al Ummah Now team moved ${channel} to another account.`,
      reason: 'Reason',
      lost: 'You no longer have access to it.',
      kept: 'You are no longer its owner, and you stay on its team as a channel admin.',
      unexpected: 'If you didn’t expect this, tell us:',
      contact: 'Contact us',
      footer: 'You received this email because a channel of yours on Al Ummah Now moved to another account.',
    },
    settings: 'You can turn these emails off in your notification settings:',
    settingsLink: 'Notification settings',
    sign: 'Al Ummah Now',
  },
  ar: {
    someone: 'أحد الأشخاص',
    channel: 'قناتك',
    newChannel: 'قناة',
    greeting: (name: string) => (name ? `السلام عليكم ${name}،` : 'السلام عليكم،'),
    offered: {
      subject: (channel: string, who: string) => `عرض من ${who} لنقل ${channel} إليك`,
      preheader: 'يمكنك قبول العرض أو رفضه.',
      heading: 'عُرضت عليك قناة',
      intro: (channel: string, who: string) => `وصلك عرض من ${who} لنقل ${channel} إليك.`,
      what: 'إذا قبلت، انتقلت إليك ملكية القناة ومرئياتها وقوائم تشغيلها ومنشوراتها.',
      contactKept: 'يبقى بريد التواصل العام كما هو.',
      until: (date: string) => `العرض مفتوح حتى ${date}.`,
      cta: 'عرض التفاصيل',
      unexpected: 'لا يتغيّر شيء ما لم تقبل.',
      footer: 'وصلتك هذه الرسالة لأن قناة عُرضت على حسابك في الأمة الآن.',
    },
    moved_in: {
      subject: (channel: string) => `انتقلت ملكية ${channel} إليك`,
      preheader: 'انتقلت ملكية القناة إليك.',
      heading: 'انتقلت إليك قناة',
      own: (channel: string, who: string) => `اكتمل النقل من ${who}، وانتقلت ملكية ${channel} إليك.`,
      team: (channel: string) => `نقل فريق الأمة الآن ${channel} إلى حسابك، وانتقلت ملكيتها إليك.`,
      what: 'انتقلت إليك أيضًا مرئياتها وقوائم تشغيلها ومنشوراتها، واستُبدلت مفاتيح البث المباشر.',
      cta: 'فتح القناة',
      footer: 'وصلتك هذه الرسالة لأن قناة نُقلت إلى حسابك في الأمة الآن.',
    },
    moved_out: {
      subject: (channel: string) => `نُقلت ${channel} إلى حساب آخر`,
      preheader: 'لم تعد ملكية القناة لك.',
      heading: 'نُقلت قناتك',
      own: (channel: string, who: string) => `قُبل عرضك، وانتقلت ملكية ${channel} إلى ${who}.`,
      team: (channel: string) => `نقل فريق الأمة الآن ${channel} إلى حساب آخر.`,
      reason: 'السبب',
      lost: 'لم يعد لديك وصول إليها.',
      kept: 'لم تعد ملكيتها لك، وتبقى ضمن فريقها بدور مشرف قناة.',
      unexpected: 'إن كان هذا غير متوقع، فيمكنك التواصل معنا:',
      contact: 'اتصل بنا',
      footer: 'وصلتك هذه الرسالة لأن قناة لك في الأمة الآن نُقلت إلى حساب آخر.',
    },
    settings: 'يمكنك إيقاف هذه الرسائل من إعدادات الإشعارات:',
    settingsLink: 'إعدادات الإشعارات',
    sign: 'الأمة الآن',
  },
} as const;

export interface ChannelMoveEmailInput {
  to: string;
  name: string;
  locale: NotificationEmailLocale;
  mail: ChannelMoveMail;
  origin: string | null;
  environment?: string;
}

/** One move email in one language on the shared branded layout. */
export function renderChannelMoveEmail(input: ChannelMoveEmailInput): RenderedEmail {
  const { mail, locale, origin } = input;
  const s = COPY[locale];
  const nameOf = (n: { name: string | null; nameLocalized?: Record<string, string> } | null, fallback: string) =>
    stripBidiControls(n?.nameLocalized?.[locale] ?? '').trim() || stripBidiControls(n?.name ?? '').trim() || fallback;
  // A channel is named as "the channel X" in Arabic, so the sentence agrees with it; a missing name reads as itself
  const raw = nameOf(mail.channel, '');
  const channel = raw ? (locale === 'ar' ? `القناة ${raw}` : raw) : mail.event === 'moved_out' ? s.channel : s.newChannel;
  const who = nameOf(mail.other, s.someone);
  const url = (path: string) => (origin ? `${origin}/${locale}${path}` : null);
  const blocks: EmailBlock[] = [];
  const after: EmailBlock[] = [];
  let copy: { heading: string; preheader: string; footer: string };
  let subject: string;
  let cta: { label: string; url: string | null } | null = null;
  if (mail.event === 'offered') {
    const c = s.offered;
    copy = c;
    subject = c.subject(channel, who);
    blocks.push({ kind: 'p', text: c.intro(channel, who) }, { kind: 'p', text: mail.offer?.keepContactEmail ? `${c.what} ${c.contactKept}` : c.what });
    if (mail.offer) {
      blocks.push({ kind: 'p', text: c.until(formatEmailDate(mail.offer.expiresAt, locale)) });
      cta = { label: c.cta, url: url(`/channel-moves/${encodeURIComponent(mail.offer.id)}`) };
    }
    after.push({ kind: 'small', text: c.unexpected });
    const settings = url('/settings#notifications');
    if (settings) after.push({ kind: 'small', text: s.settings }, { kind: 'link', label: s.settingsLink, url: settings });
  } else if (mail.event === 'moved_in') {
    const c = s.moved_in;
    copy = c;
    subject = c.subject(channel);
    blocks.push({ kind: 'p', text: mail.other ? c.own(channel, who) : c.team(channel) }, { kind: 'p', text: c.what });
    cta = { label: c.cta, url: url(`/channels/${encodeURIComponent(mail.channel.id)}`) };
  } else {
    const c = s.moved_out;
    copy = c;
    subject = c.subject(channel);
    blocks.push({ kind: 'p', text: mail.other ? c.own(channel, who) : c.team(channel) });
    // As the admin wrote it
    if (mail.reason) blocks.push({ kind: 'quote', label: c.reason, text: mail.reason });
    blocks.push({ kind: 'p', text: mail.keptAsAdmin ? c.kept : c.lost });
    const contact = url('/contact');
    if (contact) after.push({ kind: 'small', text: c.unexpected }, { kind: 'link', label: c.contact, url: contact });
  }
  const doc: EmailDoc = {
    locale,
    subject: `${envTag(input.environment)}${subject.charAt(0).toUpperCase()}${subject.slice(1)}`,
    preheader: copy.preheader,
    greeting: s.greeting(input.name),
    heading: copy.heading,
    blocks,
    ...(cta?.url ? { cta: { label: cta.label, url: cta.url } } : {}),
    after,
    signoff: s.sign,
    reason: copy.footer,
    ...(origin ? { siteUrl: origin } : {}),
  };
  const rendered = renderEmail(doc);
  return { to: input.to, subject: rendered.subject, html: rendered.html, text: rendered.text };
}

/** A Retry waits this long, so the item is marked as retrying before the email's end settles it. */
const RETRY_DELAY_SECONDS = 10;

/** Queues the email again (the Errors page's Retry). */
export async function enqueueChannelMoveMail(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, event: ChannelMoveMailEvent, id: string): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) return false;
  try {
    const job: ChannelMoveMailJob = { v: 1, kind: 'channel_move', event, id };
    await env.CONTACT_MAIL_QUEUE.send(job as never, { contentType: 'json', delaySeconds: RETRY_DELAY_SECONDS });
    return true;
  } catch (error) {
    logger.error('[ChannelMoveMail] Enqueue failed', { event, id, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const itemKey = (job: ChannelMoveMailJob) => `channel-move-mail:${job.event}:${job.id}`.slice(0, 160);

/** The email ended: its item on the Errors page, if any, is resolved. Never throws. */
async function settle(env: AdminBindings, job: ChannelMoveMailJob): Promise<void> {
  try {
    const { resolveActionItems } = await import('./errors-store');
    await resolveActionItems(env.REPORTS_DB, env.ENVIRONMENT || 'development', [itemKey(job)], new Date());
  } catch (error) {
    logger.error('[ChannelMoveMail] Could not resolve the item on the Errors page', { event: job.event, id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
}

async function flagFailure(env: AdminBindings, job: ChannelMoveMailJob, reason: string): Promise<void> {
  const item = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Channel move email not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: itemKey(job),
      source: 'email',
      title: 'Channel move email not sent',
      itemType: 'channel-move-mail',
      itemId: job.id,
      retry: { kind: 'builtin', handler: 'channel-move-mail', args: { event: job.event, id: job.id } },
      retryLabel: 'Send again',
    },
  });
  if (!item) return;
  try {
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [item]);
  } catch (error) {
    logger.error('[ChannelMoveMail] Could not flag the failure on the Errors page', { event: job.event, id: job.id, error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';

/** What api-videos answers, or null when there is nothing to send (404). */
async function read<T>(env: VideosClientEnv, path: string): Promise<T | null> {
  try {
    return await callVideos<T>(env, path);
  } catch (error) {
    if (error instanceof VideosError && error.status === 404) return null;
    throw error;
  }
}

/** Keeps how it ended, with the offer or the move: it is never sent again, however late it is asked for. */
const record = (env: VideosClientEnv, job: ChannelMoveMailJob, status: string) =>
  callVideos(env, `/channel-move-mails/${encodeURIComponent(job.event)}/${encodeURIComponent(job.id)}/delivery`, { method: 'POST', json: { status } });

/** Sends one move email. Never throws; the caller acks or retries by the outcome. */
export async function processChannelMoveMailJob(env: AdminBindings & VideosClientEnv, msg: QueueMessageLike<ChannelMoveMailJob>): Promise<Outcome> {
  const outcome = await send(env, msg);
  if (outcome === 'done') await settle(env, msg.body);
  return outcome;
}

async function send(env: AdminBindings & VideosClientEnv, msg: QueueMessageLike<ChannelMoveMailJob>): Promise<Outcome> {
  const job = msg.body;
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[ChannelMoveMail] Email failed for good', { alert: 'channel_move_email_failed', event: job.event, id: job.id, attempts: msg.attempts, reason });
    await record(env, job, 'failed').catch(() => undefined);
    await flagFailure(env, job, reason);
    return 'failed';
  };
  try {
    if (job.v !== 1 || !job.id || !job.event) {
      logger.error('[ChannelMoveMail] Malformed job dropped', { id: msg.id });
      return 'done';
    }
    const mail = await read<ChannelMoveMail>(env, `/channel-move-mails/${encodeURIComponent(job.event)}/${encodeURIComponent(job.id)}`);
    if (!mail) return 'done';
    // No profile any more: nobody to write to
    const contact = await read<AccountEmailContact>(env, `/users/${encodeURIComponent(mail.recipientId)}/account-email`);
    if (!contact) return 'done';
    // Losing or getting a channel is always told (CC-D11); an offer follows the setting
    const decision = accountEmailDecision(mail.event === 'offered' ? contact : { ...contact, accountEmail: true });
    if ('status' in decision) {
      logger.debug('[ChannelMoveMail] Not sent', { event: job.event, id: job.id, status: decision.status });
      await record(env, job, decision.status);
      return 'done';
    }
    const email = renderChannelMoveEmail({ to: decision.to, name: contact.displayName, locale: decision.locale, mail, origin: videosWebOrigin(env), environment: env.ENVIRONMENT });
    const result = await sendContactEmail(env, email, { idempotencyKey: `channel-move-${job.event}-${job.id}` });
    if (result.status !== 'failed') {
      await record(env, job, result.status === 'sunk' ? 'sunk' : 'sent');
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) return 'retry';
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[ChannelMoveMail] Job errored; will retry', { event: job.event, id: job.id, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    return fail(reason);
  }
}
