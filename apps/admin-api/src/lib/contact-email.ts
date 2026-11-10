/**
 * Contact us emails: the support-inbox notification, the sender's
 * acknowledgement and staff replies. Sent through Resend (the platform's
 * sender, same account as the auth server's codes). No imports beyond
 * ./contact, so rendering and the send decision are unit tested.
 */
import { isSinkAddress, type ContactLocale, type ContactTopic } from './contact';

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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** "> " before every line, as mail clients quote. */
export function quoteText(s: string): string {
  return s
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function formatDate(iso: string, locale: ContactLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
}

function htmlDocument(locale: ContactLocale, inner: string): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;font-size:15px;line-height:1.6">${inner}</body></html>`;
}

const paragraphs = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
const blockquote = (s: string) =>
  `<blockquote style="margin:16px 0 0;padding:0 12px;border-inline-start:3px solid currentColor;opacity:.75">${paragraphs(s)}</blockquote>`;

/** Environment tag in subjects outside production, so QA mail is never mistaken for real mail. */
const envTag = (environment: string | undefined) => (environment && environment !== 'production' ? `[${environment}] ` : '');

export function renderInboxNotification(m: MessageForEmail, opts: { to: string; adminUrl?: string; environment?: string }): RenderedEmail {
  const link = opts.adminUrl ? `${opts.adminUrl.replace(/\/$/, '')}/contact/${encodeURIComponent(m.id)}` : '';
  const lines = [
    `New Contact us message (${topicLabel(m.topic, 'en')})`,
    '',
    `From: ${m.name} <${m.email}>${m.user_id ? ` (signed in, user ${m.user_id})` : ' (signed out)'}`,
    `Language: ${m.locale}`,
    m.page_url ? `Page: ${m.page_url}` : '',
    `Received: ${formatDate(m.created_at, 'en')}`,
    '',
    m.message,
    '',
    link ? `Open in the admin inbox: ${link}` : '',
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');
  const html = htmlDocument(
    'en',
    `<p><strong>New Contact us message</strong> (${escapeHtml(topicLabel(m.topic, 'en'))})</p>
<p>From: ${escapeHtml(m.name)} &lt;${escapeHtml(m.email)}&gt;${m.user_id ? ` (signed in)` : ' (signed out)'}<br>Language: ${m.locale}${
      m.page_url ? `<br>Page: ${escapeHtml(m.page_url)}` : ''
    }<br>Received: ${escapeHtml(formatDate(m.created_at, 'en'))}</p>
<div dir="auto">${paragraphs(m.message)}</div>${link ? `<p><a href="${escapeHtml(link)}">Open in the admin inbox</a></p>` : ''}`,
  );
  return {
    to: opts.to,
    subject: `${envTag(opts.environment)}[Contact] ${topicLabel(m.topic, 'en')}: ${m.name}`.slice(0, 200),
    text: lines.join('\n'),
    html,
    replyTo: m.email,
  };
}

const ACK = {
  en: {
    subject: 'We received your message',
    greeting: (name: string) => `Assalamu alaikum ${name},`,
    body: 'Thank you for contacting Al Ummah Now. We have received your message and will reply to this address as soon as we can.',
    topic: 'Topic',
    yours: 'Your message:',
    sign: 'Al Ummah Now support',
  },
  ar: {
    subject: 'وصلتنا رسالتك',
    greeting: (name: string) => `السلام عليكم ${name}،`,
    body: 'شكرًا لتواصلك مع الأمة الآن. وصلتنا رسالتك وسنرد عليك على هذا العنوان في أقرب وقت ممكن.',
    topic: 'الموضوع',
    yours: 'رسالتك:',
    sign: 'فريق دعم الأمة الآن',
  },
};

export function renderAcknowledgement(m: MessageForEmail, opts: { replyTo?: string; environment?: string }): RenderedEmail {
  const s = ACK[m.locale];
  const text = [s.greeting(m.name), '', s.body, '', `${s.topic}: ${topicLabel(m.topic, m.locale)}`, s.yours, quoteText(m.message), '', `— ${s.sign}`].join('\n');
  const html = htmlDocument(
    m.locale,
    `<p>${escapeHtml(s.greeting(m.name))}</p><p>${escapeHtml(s.body)}</p><p>${escapeHtml(s.topic)}: ${escapeHtml(topicLabel(m.topic, m.locale))}</p><p>${escapeHtml(s.yours)}</p>${blockquote(m.message)}<p>— ${escapeHtml(s.sign)}</p>`,
  );
  return { to: m.email, subject: `${envTag(opts.environment)}${s.subject}`, text, html, replyTo: opts.replyTo };
}

const REPLY = {
  en: {
    subject: 'Re: your message to Al Ummah Now',
    greeting: (name: string) => `Assalamu alaikum ${name},`,
    wrote: (date: string) => `On ${date}, you wrote:`,
    sign: 'Al Ummah Now support',
  },
  ar: {
    subject: 'رد: رسالتك إلى الأمة الآن',
    greeting: (name: string) => `السلام عليكم ${name}،`,
    wrote: (date: string) => `في ${date}، كتبت:`,
    sign: 'فريق دعم الأمة الآن',
  },
};

/** A staff reply in the message's language, with the original message quoted under it. */
export function renderReply(m: MessageForEmail, reply: string, opts: { replyTo?: string; environment?: string }): RenderedEmail {
  const s = REPLY[m.locale];
  const date = formatDate(m.created_at, m.locale);
  const text = [s.greeting(m.name), '', reply, '', `— ${s.sign}`, '', s.wrote(date), quoteText(m.message)].join('\n');
  const html = htmlDocument(
    m.locale,
    `<p>${escapeHtml(s.greeting(m.name))}</p><div dir="auto">${paragraphs(reply)}</div><p>— ${escapeHtml(s.sign)}</p><p style="margin-top:24px">${escapeHtml(s.wrote(date))}</p>${blockquote(m.message)}`,
  );
  return { to: m.email, subject: `${envTag(opts.environment)}${s.subject}`, text, html, replyTo: opts.replyTo };
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
