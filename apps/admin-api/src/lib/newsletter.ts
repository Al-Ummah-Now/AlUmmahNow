/**
 * Newsletter (AlUmmahNowUI#6): what a sign-up and an issue may contain, tokens, rate limits and the
 * two emails (confirm a sign-up; an issue). Double opt-in: the www form only creates a pending
 * subscriber and emails a confirmation link; issues go to confirmed subscribers only, each with an
 * unsubscribe link and RFC 8058 one-click List-Unsubscribe headers.
 *
 * Links point at www (`NEWSLETTER_SITE_URL`): /{l}/newsletter/confirm?token= and
 * /{l}/newsletter/unsubscribe?token= show a button that POSTs (mail scanners open links, so a GET
 * never changes anything); the one-click POST goes to the same unsubscribe URL.
 */
import { renderEmail, SITE_URL, type EmailBlock, type EmailDoc, type EmailLocale } from './email/layout';
import { envTag, type RenderedEmail } from './contact-email';
import { isValidEmail } from './contact';

export const NEWSLETTER_LOCALES = ['en', 'ar'] as const;
export type NewsletterLocale = (typeof NEWSLETTER_LOCALES)[number];
export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type IssueStatus = 'draft' | 'sending' | 'sent';

export const NEWSLETTER_LIMITS = {
  emailMax: 254,
  subjectMax: 150,
  bodyMax: 20000,
  /** The confirmation link works this long. */
  confirmDays: 7,
  /** A second sign-up with the same address within this window sends no second email. */
  resendMinutes: 10,
} as const;

/** Sign-ups per IP (keyed hash) per hour. QA/stage are roomy for the E2E runs. */
export function newsletterRateLimit(environment: string | undefined): number {
  return environment === 'production' ? 10 : 500;
}

export const isNewsletterLocale = (v: unknown): v is NewsletterLocale => v === 'en' || v === 'ar';

/** A sign-up body → the address and language, or null (bad address). */
export function parseSignup(raw: unknown): { email: string; locale: NewsletterLocale } | null {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email || email.length > NEWSLETTER_LIMITS.emailMax || !isValidEmail(email)) return null;
  return { email, locale: isNewsletterLocale(body.locale) ? body.locale : 'en' };
}

/** Bots fill the hidden `website` field; their sign-up gets the same answer and is dropped. */
export function isNewsletterBot(raw: unknown): boolean {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return typeof body.website === 'string' && body.website.trim() !== '';
}

/** 32 random bytes, base64url (43 characters). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IssueContent {
  subject_en: string;
  subject_ar: string;
  body_en: string;
  body_ar: string;
}

/** Normalises an issue edit: trimmed, CRLF → LF, within the limits. Unknown fields are ignored. */
export function cleanIssueInput(raw: unknown): { ok: true; value: Partial<IssueContent> } | { ok: false; error: string } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const value: Partial<IssueContent> = {};
  for (const [field, max] of [
    ['subject_en', NEWSLETTER_LIMITS.subjectMax],
    ['subject_ar', NEWSLETTER_LIMITS.subjectMax],
    ['body_en', NEWSLETTER_LIMITS.bodyMax],
    ['body_ar', NEWSLETTER_LIMITS.bodyMax],
  ] as const) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== 'string') return { ok: false, error: `${field} must be text` };
    const s = field.startsWith('subject') ? v.replace(/\s+/g, ' ').trim() : v.replace(/\r\n?/g, '\n').trim();
    if (s.length > max) return { ok: false, error: `${field} is longer than ${max} characters` };
    value[field] = s;
  }
  return { ok: true, value };
}

/** Fields still empty before an issue can be sent (both languages are required). */
export function missingForSend(issue: IssueContent): (keyof IssueContent)[] {
  return (['subject_en', 'subject_ar', 'body_en', 'body_ar'] as const).filter((f) => !issue[f]?.trim());
}

/**
 * An issue body → email blocks: paragraphs split on blank lines; a paragraph that is only an
 * https:// address becomes a link (its address as the label).
 */
export function bodyBlocks(body: string): EmailBlock[] {
  const out: EmailBlock[] = [];
  for (const para of body.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const text = para.trim();
    if (!text) continue;
    if (/^https:\/\/\S+$/.test(text)) out.push({ kind: 'link', label: text, url: text });
    else out.push({ kind: 'p', text });
  }
  return out;
}

/** www origin for links in newsletter emails. */
export function siteUrlOf(env: { NEWSLETTER_SITE_URL?: string }): string {
  const v = env.NEWSLETTER_SITE_URL?.trim().replace(/\/+$/, '');
  return v && /^https?:\/\//.test(v) ? v : SITE_URL;
}

export const confirmUrl = (site: string, locale: NewsletterLocale, token: string) => `${site}/${locale}/newsletter/confirm?token=${encodeURIComponent(token)}`;
export const unsubscribeUrl = (site: string, locale: NewsletterLocale, token: string) => `${site}/${locale}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;

const COPY = {
  en: {
    confirmSubject: 'Confirm your Al Ummah Now newsletter subscription',
    confirmHeading: 'Confirm your subscription',
    confirmPreheader: 'One click and you will start getting the newsletter.',
    confirmIntro: 'Someone, hopefully you, asked to get the Al Ummah Now newsletter at this address.',
    confirmNext: (days: number) => `Confirm to start getting it. The link works for ${days} days.`,
    confirmCta: 'Confirm subscription',
    confirmIgnore: "If you didn't ask for this, ignore this email and you won't be subscribed.",
    confirmReason: 'You received this email because this address was entered in the newsletter form on alummahnow.net.',
    issueWhy: 'You are getting this because you subscribed to the Al Ummah Now newsletter.',
    unsubscribe: 'Unsubscribe',
    issueReason: 'You received this email because you subscribed to the Al Ummah Now newsletter.',
    sign: 'Al Ummah Now',
  },
  ar: {
    confirmSubject: 'أكّد اشتراكك في النشرة البريدية للأمة الآن',
    confirmHeading: 'أكّد اشتراكك',
    confirmPreheader: 'بنقرة واحدة تبدأ باستلام النشرة البريدية.',
    confirmIntro: 'طلب أحدهم، ونرجو أن تكون أنت، استلام النشرة البريدية للأمة الآن على هذا العنوان.',
    confirmNext: (days: number) => `أكّد لتبدأ باستلامها. يعمل الرابط لمدة ${days.toLocaleString('ar-EG')} أيام.`,
    confirmCta: 'تأكيد الاشتراك',
    confirmIgnore: 'إن لم تطلب ذلك فتجاهل هذه الرسالة ولن يتم اشتراكك.',
    confirmReason: 'وصلتك هذه الرسالة لأن هذا العنوان أُدخل في نموذج النشرة البريدية على alummahnow.net.',
    issueWhy: 'وصلتك هذه الرسالة لأنك مشترك في النشرة البريدية للأمة الآن.',
    unsubscribe: 'إلغاء الاشتراك',
    issueReason: 'وصلتك هذه الرسالة لأنك مشترك في النشرة البريدية للأمة الآن.',
    sign: 'الأمة الآن',
  },
} as const;

export function renderConfirmEmail(input: { to: string; locale: NewsletterLocale; token: string; site: string; environment?: string }): RenderedEmail {
  const s = COPY[input.locale];
  const doc: EmailDoc = {
    locale: input.locale as EmailLocale,
    subject: `${envTag(input.environment)}${s.confirmSubject}`,
    preheader: s.confirmPreheader,
    heading: s.confirmHeading,
    blocks: [
      { kind: 'p', text: s.confirmIntro },
      { kind: 'p', text: s.confirmNext(NEWSLETTER_LIMITS.confirmDays) },
    ],
    cta: { label: s.confirmCta, url: confirmUrl(input.site, input.locale, input.token) },
    after: [{ kind: 'small', text: s.confirmIgnore }],
    signoff: s.sign,
    reason: s.confirmReason,
    siteUrl: input.site,
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

/** One issue for one subscriber, in the subscriber's language, with unsubscribe link and headers. */
export function renderIssueEmail(input: { to: string; locale: NewsletterLocale; issue: IssueContent; unsubscribeToken: string; site: string; environment?: string }): RenderedEmail {
  const s = COPY[input.locale];
  const subject = input.locale === 'ar' ? input.issue.subject_ar : input.issue.subject_en;
  const body = input.locale === 'ar' ? input.issue.body_ar : input.issue.body_en;
  const unsub = unsubscribeUrl(input.site, input.locale, input.unsubscribeToken);
  const blocks = bodyBlocks(body);
  const first = blocks.find((b) => b.kind === 'p') as { text: string } | undefined;
  const doc: EmailDoc = {
    locale: input.locale as EmailLocale,
    subject: `${envTag(input.environment)}${subject}`,
    preheader: (first?.text ?? subject).slice(0, 120),
    heading: subject,
    blocks,
    after: [
      { kind: 'small', text: s.issueWhy },
      { kind: 'link', label: s.unsubscribe, url: unsub },
    ],
    signoff: s.sign,
    reason: s.issueReason,
    siteUrl: input.site,
  };
  const rendered = renderEmail(doc);
  return {
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
