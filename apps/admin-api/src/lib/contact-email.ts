/**
 * Contact us emails: the support-inbox notification, the sender's
 * acknowledgement and staff replies. Sent through Resend (the platform's
 * sender, same account as the auth server's codes), in the shared design
 * (./email/layout.ts). Rendering and the send decision are unit tested.
 */
import { isSinkAddress, type ContactLocale, type ContactTopic } from './contact';
import { escapeHtml, formatEmailDate, renderEmail, type EmailDoc } from './email/layout';

export const DEFAULT_CONTACT_FROM = 'Al Ummah Now <support@alummahnow.net>';

const TOPIC_LABELS: Record<ContactLocale, Record<ContactTopic, string>> = {
  en: {
    general: 'General',
    account: 'Account & sign-in',
    problem: 'Report a problem',
    content: 'Content & copyright',
    partnership: 'Partnership',
  },
  ar: {
    general: 'استفسار عام',
    account: 'الحساب وتسجيل الدخول',
    problem: 'الإبلاغ عن مشكلة',
    content: 'المحتوى وحقوق النشر',
    partnership: 'الشراكات',
  },
};

export const topicLabel = (topic: ContactTopic, locale: ContactLocale) => TOPIC_LABELS[locale][topic] ?? topic;

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface MessageForEmail {
  id: string;
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  locale: ContactLocale;
  page_url: string | null;
  user_id: string | null;
  created_at: string;
}

export { escapeHtml };

/** "> " before every line, as mail clients quote. */
export function quoteText(s: string): string {
  return s
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** Environment tag in subjects outside production, so QA mail is never mistaken for real mail. */
export const envTag = (environment: string | undefined) => (environment && environment !== 'production' ? `[${environment}] ` : '');

const withEnv = (doc: EmailDoc, environment: string | undefined): EmailDoc => ({ ...doc, subject: `${envTag(environment)}${doc.subject}` });

/** Staff only (the support inbox), always English. */
export function renderInboxNotification(m: MessageForEmail, opts: { to: string; adminUrl?: string; environment?: string }): RenderedEmail {
  const link = opts.adminUrl ? `${opts.adminUrl.replace(/\/$/, '')}/contact/${encodeURIComponent(m.id)}` : '';
  const topic = topicLabel(m.topic, 'en');
  const doc = withEnv(
    {
      locale: 'en',
      subject: `[Contact] ${topic}: ${m.name}`.slice(0, 200),
      preheader: `${m.name} wrote about ${topic.toLowerCase()}: ${m.message.replace(/\s+/g, ' ').slice(0, 90)}`,
      heading: `New Contact us message (${topic})`,
      blocks: [
        {
          kind: 'facts',
          rows: [
            ['From', `${m.name} <${m.email}>`],
            ['Account', m.user_id ? `Signed in (user ${m.user_id})` : 'Signed out'],
            ['Language', m.locale === 'ar' ? 'Arabic' : 'English'],
            ...(m.page_url ? ([['Page', m.page_url]] as [string, string][]) : []),
            ['Received', formatEmailDate(m.created_at, 'en', true)],
          ],
        },
        { kind: 'quote', label: 'Message', text: m.message },
      ],
      ...(link ? { cta: { label: 'Open in the admin inbox', url: link } } : {}),
      reason: 'You got this email because this address is the Al Ummah Now support inbox. Reply from the admin so the thread is recorded (replying here goes straight to the sender).',
      automated: false,
    },
    opts.environment,
  );
  return { to: opts.to, ...renderEmail(doc), replyTo: m.email };
}

const ACK = {
  en: {
    subject: 'We received your message',
    preheader: 'Thank you for contacting Al Ummah Now. We will reply to this address.',
    greeting: (name: string) => `Assalamu alaikum ${name},`,
    body: 'Thank you for contacting Al Ummah Now. We have received your message and will reply to this address as soon as we can.',
    topic: 'Topic',
    yours: 'Your message',
    sign: 'Al Ummah Now support',
    reason: 'You got this email because this address was used on the Al Ummah Now Contact us form.',
  },
  ar: {
    subject: 'وصلتنا رسالتك',
    preheader: 'شكرًا لتواصلك مع الأمة الآن. سنرد عليك على هذا العنوان.',
    greeting: (name: string) => `السلام عليكم ${name}،`,
    body: 'شكرًا لتواصلك مع الأمة الآن. وصلتنا رسالتك وسنرد عليك على هذا العنوان في أقرب وقت ممكن.',
    topic: 'الموضوع',
    yours: 'رسالتك',
    sign: 'فريق دعم الأمة الآن',
    reason: 'وصلتك هذه الرسالة لأن هذا العنوان استُخدم في نموذج «تواصل معنا» في الأمة الآن.',
  },
};

/** To the sender, in the language of the Contact us page they wrote from. */
export function renderAcknowledgement(m: MessageForEmail, opts: { replyTo?: string; environment?: string }): RenderedEmail {
  const locale = m.locale === 'ar' ? 'ar' : 'en';
  const s = ACK[locale];
  const doc = withEnv(
    {
      locale,
      subject: s.subject,
      preheader: s.preheader,
      greeting: s.greeting(m.name),
      blocks: [
        { kind: 'p', text: s.body },
        { kind: 'facts', rows: [[s.topic, topicLabel(m.topic, locale)]] },
        { kind: 'quote', label: s.yours, text: m.message },
      ],
      signoff: `— ${s.sign}`,
      reason: s.reason,
      automated: false,
    },
    opts.environment,
  );
  return { to: m.email, ...renderEmail(doc), replyTo: opts.replyTo };
}

const REPLY = {
  en: {
    subject: 'Re: your message to Al Ummah Now',
    preheader: (reply: string) => reply.replace(/\s+/g, ' ').slice(0, 110),
    greeting: (name: string) => `Assalamu alaikum ${name},`,
    wrote: (date: string) => `On ${date}, you wrote`,
    sign: 'Al Ummah Now support',
    reason: 'You got this email because you wrote to Al Ummah Now through the Contact us form. You can reply to this email.',
  },
  ar: {
    subject: 'رد: رسالتك إلى الأمة الآن',
    preheader: (reply: string) => reply.replace(/\s+/g, ' ').slice(0, 110),
    greeting: (name: string) => `السلام عليكم ${name}،`,
    wrote: (date: string) => `في ${date}، كتبت`,
    sign: 'فريق دعم الأمة الآن',
    reason: 'وصلتك هذه الرسالة لأنك راسلت الأمة الآن عبر نموذج «تواصل معنا». يمكنك الرد على هذه الرسالة.',
  },
};

/**
 * The language a reply was sent in, from its stored subject (contact_notes.email_subject,
 * rendered when the admin pressed Send), so a retry keeps the admin's choice.
 */
export function replyLocaleOf(subject: string | null | undefined): ContactLocale | null {
  const bare = (subject ?? '').replace(/^\[[^\]]*\]\s*/, '');
  if (bare === REPLY.ar.subject) return 'ar';
  if (bare === REPLY.en.subject) return 'en';
  return null;
}

/**
 * A staff reply in ONE language: the one the admin picked next to Send
 * (default: the message's language), with the original message quoted under it.
 */
export function renderReply(m: MessageForEmail, reply: string, opts: { replyTo?: string; environment?: string; locale?: ContactLocale }): RenderedEmail {
  const locale: ContactLocale = opts.locale ?? (m.locale === 'ar' ? 'ar' : 'en');
  const s = REPLY[locale];
  const doc = withEnv(
    {
      locale,
      subject: s.subject,
      preheader: s.preheader(reply),
      greeting: s.greeting(m.name),
      blocks: [{ kind: 'p', text: reply }],
      signoff: `— ${s.sign}`,
      after: [{ kind: 'quote', label: s.wrote(formatEmailDate(m.created_at, locale, true)), text: m.message }],
      reason: s.reason,
      automated: false,
    },
    opts.environment,
  );
  return { to: m.email, ...renderEmail(doc), replyTo: opts.replyTo };
}

/** queued: waiting in the mail queue; failed: gave up after retries (flagged for an admin). */
export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'sunk';

export interface MailerEnv {
  ENVIRONMENT?: string;
  /** Secrets Store binding (deployed) or plain string (local dev) */
  RESEND_API_KEY?: string | { get(): Promise<string> };
  CONTACT_FROM?: string;
}

async function resolveSecret(binding: MailerEnv['RESEND_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  if (binding && typeof binding.get === 'function') {
    try {
      return (await binding.get()) || '';
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Sends one email. Outside production, E2E addresses (@e2e.alummahnow.net,
 * which has no mail server) are not sent: the status is "sunk" and the E2E
 * suite reads it back from the message's record. Never throws. `retryable`
 * marks failures worth another attempt (network, 429, 5xx).
 */
export async function sendContactEmail(
  env: MailerEnv,
  email: RenderedEmail,
  opts: { idempotencyKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ status: DeliveryStatus; id?: string; error?: string; retryable?: boolean }> {
  if (isSinkAddress(email.to, env.ENVIRONMENT)) return { status: 'sunk' };
  const key = await resolveSecret(env.RESEND_API_KEY);
  if (!key) return { status: 'failed', error: 'RESEND_API_KEY is not bound', retryable: false };
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM || DEFAULT_CONTACT_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200);
      return { status: 'failed', error: `Resend ${res.status}: ${text}`, retryable: res.status === 429 || res.status >= 500 };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: 'sent', id: body.id };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), retryable: true };
  }
}
