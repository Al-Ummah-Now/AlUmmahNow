/**
 * Contact us form rules on the client. The same limits are enforced by
 * admin-api (apps/admin-api/src/lib/contact.ts); keep the numbers equal.
 */
import type { ContactTopicKey } from '@al-ummah/shared-types';

export const CONTACT_TOPICS: ContactTopicKey[] = ['general', 'account', 'problem', 'content', 'partnership'];

export const CONTACT_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 5000,
} as const;

export type ContactField = 'name' | 'email' | 'topic' | 'message';
export type ContactFieldError = 'required' | 'tooShort' | 'tooLong' | 'invalid';
export type ContactErrors = Partial<Record<ContactField, ContactFieldError>>;

export interface ContactFormValues {
  name: string;
  email: string;
  topic: ContactTopicKey | '';
  message: string;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function validateContactForm(v: ContactFormValues): ContactErrors {
  const errors: ContactErrors = {};
  const name = v.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length > CONTACT_LIMITS.nameMax) errors.name = 'tooLong';

  const email = v.email.trim();
  if (!email) errors.email = 'required';
  else if (email.length > CONTACT_LIMITS.emailMax) errors.email = 'tooLong';
  else if (!EMAIL.test(email)) errors.email = 'invalid';

  if (!v.topic) errors.topic = 'required';
  else if (!CONTACT_TOPICS.includes(v.topic)) errors.topic = 'invalid';

  const message = v.message.trim();
  if (!message) errors.message = 'required';
  else if (message.length < CONTACT_LIMITS.messageMin) errors.message = 'tooShort';
  else if (message.length > CONTACT_LIMITS.messageMax) errors.message = 'tooLong';
  return errors;
}

/** ?topic=problem preselects a topic (links from the player and reports). */
export function topicFromParam(value: string | null | undefined): ContactTopicKey | '' {
  return value && (CONTACT_TOPICS as string[]).includes(value) ? (value as ContactTopicKey) : '';
}

/**
 * The page the visitor came from, when it is on this site: ?from= wins (links
 * that know their page), then the referrer. Never the contact page itself.
 */
export function capturePageUrl(from: string | null | undefined, referrer: string, origin: string): string {
  for (const candidate of [from, referrer]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate, origin);
      if (url.origin !== origin || /^\/(en|ar)\/contact\/?$/.test(url.pathname)) continue;
      return url.toString();
    } catch {
      // not a URL
    }
  }
  return '';
}

/** "{min}"-style placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}
