/**
 * Contact us: what a message may contain, spam checks and rate limits.
 * No imports, so it is unit tested without the Workers runtime.
 */

export const CONTACT_TOPICS = ['general', 'account', 'problem', 'content', 'partnership'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Read and unread are separate (read_at, migration 0038): a new message is 'open' and unread. */
export const CONTACT_STATUSES = ['open', 'in_progress', 'replied', 'closed', 'spam'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** The Turnstile outcome when the message was sent (lib/bot-guard.ts checkHuman). */
export const CONTACT_BOT_VERDICTS = ['pass', 'fail', 'missing', 'error', 'off', 'bypass'] as const;
export type ContactBotVerdict = (typeof CONTACT_BOT_VERDICTS)[number];

/** Why a message is spam: Turnstile did not pass, its text reads as a sales pitch, or an admin marked it. */
export const CONTACT_SPAM_REASONS = ['turnstile', 'content', 'admin'] as const;
export type ContactSpamReason = (typeof CONTACT_SPAM_REASONS)[number];

export const CONTACT_LOCALES = ['en', 'ar'] as const;
export type ContactLocale = (typeof CONTACT_LOCALES)[number];

/** Character limits; the web form uses the same numbers (apps/web/src/lib/contact/limits.ts). */
export const CONTACT_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 5000,
  pageUrlMax: 2048,
  userAgentMax: 512,
  noteMax: 5000,
  replyMax: 10000,
} as const;

/** A person needs at least this long to fill the form; faster is a bot. */
export const MIN_FILL_MS = 3000;

export type ContactFieldError = 'required' | 'tooShort' | 'tooLong' | 'invalid';
export type ContactField = 'name' | 'email' | 'topic' | 'message';

export interface ContactInput {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  locale: ContactLocale;
  pageUrl: string | null;
}

export type ValidationResult =
  | { ok: true; value: ContactInput }
  | { ok: false; errors: Partial<Record<ContactField, ContactFieldError>> };

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** Collapses runs of spaces and drops control characters, keeping line breaks in the message. */
const clean = (v: string, multiline = false) =>
  // eslint-disable-next-line no-control-regex
  (multiline ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '') : v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ')).trim();

export function isValidEmail(email: string): boolean {
  return email.length <= CONTACT_LIMITS.emailMax && EMAIL.test(email);
}

/**
 * Only http(s) pages of our own sites are kept, so the inbox never shows a
 * link somewhere else. Anything else becomes null rather than an error: the
 * page URL is captured automatically, the sender never typed it.
 */
export function cleanPageUrl(raw: unknown): string | null {
  const value = str(raw).trim();
  if (!value || value.length > CONTACT_LIMITS.pageUrlMax) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname;
    const ours = host === 'alummahnow.net' || host.endsWith('.alummahnow.net') || host === 'localhost' || host === '127.0.0.1';
    return ours ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Validates a submission. `accountEmail` is the signed-in account's email:
 * when set it replaces whatever email the form sent.
 */
export function validateContactInput(raw: unknown, accountEmail?: string | null): ValidationResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<ContactField, ContactFieldError>> = {};

  const name = clean(str(body.name));
  if (!name) errors.name = 'required';
  else if (name.length > CONTACT_LIMITS.nameMax) errors.name = 'tooLong';

  const email = (accountEmail || clean(str(body.email))).toLowerCase();
  if (!email) errors.email = 'required';
  else if (email.length > CONTACT_LIMITS.emailMax) errors.email = 'tooLong';
  else if (!isValidEmail(email)) errors.email = 'invalid';

  const topic = str(body.topic);
  if (!topic) errors.topic = 'required';
  else if (!(CONTACT_TOPICS as readonly string[]).includes(topic)) errors.topic = 'invalid';

  const message = clean(str(body.message), true);
  if (!message) errors.message = 'required';
  else if (message.length < CONTACT_LIMITS.messageMin) errors.message = 'tooShort';
  else if (message.length > CONTACT_LIMITS.messageMax) errors.message = 'tooLong';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const locale = (CONTACT_LOCALES as readonly string[]).includes(str(body.locale)) ? (str(body.locale) as ContactLocale) : 'en';
  return { ok: true, value: { name, email, topic: topic as ContactTopic, message, locale, pageUrl: cleanPageUrl(body.pageUrl) } };
}

/**
 * Bot checks: the hidden `website` field (people never see it, bots fill it)
 * and the time between the form appearing and being sent. A bot's message is
 * accepted silently and dropped, so it learns nothing.
 */
export function isLikelyBot(raw: unknown): boolean {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (str(body.website).trim() !== '') return true;
  const elapsed = Number(body.elapsedMs);
  return !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS;
}

export interface ContactRateLimits {
  perIpHour: number;
  perIpDay: number;
  perUserHour: number;
  perUserDay: number;
}

/**
 * Production is strict. QA and stage are enforced too (the limiter runs there)
 * but roomy, because the release E2E sends from a handful of CI addresses.
 */
export const CONTACT_RATE_LIMITS: Record<'strict' | 'relaxed', ContactRateLimits> = {
  strict: { perIpHour: 5, perIpDay: 20, perUserHour: 5, perUserDay: 20 },
  relaxed: { perIpHour: 120, perIpDay: 1000, perUserHour: 60, perUserDay: 500 },
};

export function rateLimitsFor(environment: string | undefined): ContactRateLimits {
  return environment === 'production' ? CONTACT_RATE_LIMITS.strict : CONTACT_RATE_LIMITS.relaxed;
}

/** The E2E address domain (as in the auth server): never emailed outside production. */
export const E2E_EMAIL_DOMAIN = 'e2e.alummahnow.net';

export function isSinkAddress(email: string, environment: string | undefined): boolean {
  if (environment === 'production') return false;
  const at = email.lastIndexOf('@');
  return at > 0 && email.slice(at + 1).toLowerCase() === E2E_EMAIL_DOMAIN;
}

/** Keyed hash of the sender's IP: enough to count, useless to recover the address. */
export async function hashIp(ip: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key || 'contact'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(ip || 'unknown')));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare for the internal API key. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Marketing-pitch markers: the cold "we can grow your business" messages the
 * form attracts (SEO, ads, web design offers). Each is a phrase, matched as
 * whole words, case-insensitive.
 */
const PITCH_MARKERS: readonly RegExp[] = [
  /\bonline (visibility|presence)\b/i,
  /\brank(ing)? (higher |#?1 |first )?(on|in) google\b/i,
  /\b(seo|search engine optimi[sz]ation)\b/i,
  /\bbacklinks?\b/i,
  /\b(website|web|organic) traffic\b/i,
  /\bdigital marketing\b/i,
  /\blead generation\b/i,
  /\bgrow your (business|brand|online|website|sales)\b/i,
  /\b(squarespace|shopify|wix|wordpress|godaddy)\b.*\b(squarespace|shopify|wix|wordpress|godaddy)\b/is,
  /\bai[- ]powered search\b/i,
  /\b(kindly )?(provide|send|share) (me )?your (name, )?(phone|whats ?app|contact) (number|details)\b/i,
  /\bguest post(s|ing)?\b/i,
];

const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./gi;

/**
 * A conservative spam check for the text of a message: two different pitch
 * markers, or three links or more. One marker alone (a viewer asking about
 * "SEO for my channel") is a normal message. Returns the reason or null.
 */
export function contentSpamReason(message: string): 'content' | null {
  const markers = PITCH_MARKERS.filter((re) => re.test(message)).length;
  const links = message.match(LINK)?.length ?? 0;
  return markers >= 2 || links >= 3 ? 'content' : null;
}

/**
 * Whether a new message goes straight to Spam, and why. Turnstile in monitor
 * mode lets a failed or missing check through (enforce mode refuses it before
 * this), so it is recorded and filed as spam; error/off/bypass are not
 * judgements and fall through to the content check.
 */
export function initialSpamReason(verdict: ContactBotVerdict, message: string): ContactSpamReason | null {
  if (verdict === 'fail' || verdict === 'missing') return 'turnstile';
  return contentSpamReason(message);
}
