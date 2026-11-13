/**
 * Privacy of the processor's queue-message archive (r2 al-ummah-now-messages, #1177).
 *
 * The archive keeps queue messages for statistics and abuse investigation. What it stores about a
 * person is pseudonymised before it is written:
 *
 * - Every user id (person-id keys such as `userId`, `viewerId`, `reporterId`, `actor.userId`, and any
 *   `usr_…` value anywhere) becomes a pseudonym `ps_<hex>`: HMAC-SHA-256 of the id under a random
 *   secret kept for that user (processor NOTIFICATIONS_DB archive_subjects). Erasing the account
 *   deletes the secret, so its archived events no longer lead to anyone.
 * - Free text and device details are dropped: descriptions, texts, comments, messages, notes,
 *   search queries, user agents, names and emails. Referrers keep only their host, URLs lose their
 *   query and fragment, and an email inside any other string is replaced.
 * - Erasure messages themselves keep no id: their person ids become the erased marker.
 *
 * Pure and synchronous apart from `archivePseudonym` (Web Crypto), so the processor (at write time)
 * and api-videos (the one-off rewrite of older entries) apply the same rules.
 */

/** Marks a record this module already scrubbed; the rewrite skips such records. */
export const ARCHIVE_PRIVACY_VERSION = 'pseudonymised-v1';

/** Marker for a person whose account was erased (same value the erasure writes elsewhere). */
export const ARCHIVE_ERASED_MARKER = 'deleted-user';

/** Marker for a person id that could not be pseudonymised (no secret store bound). */
export const ARCHIVE_ANONYMOUS_MARKER = 'anonymous';

const USER_ID_VALUE = /^usr_[0-9a-f]{32}$/;
const PSEUDONYM_VALUE = /^ps_[0-9a-f]{32}$/;

/** Keys whose value is a person's id (or a list of them). */
const PERSON_ID_KEY =
  /^(?:[a-z]*?)(?:user|viewer|reporter|owner|author|actor|profile|subscriber|member|recipient|resolver|moderator|reviewer|admin|uploader|creator|voter|liker|inviter|target(?=User))(?:User)?Ids?$|^(?:created|updated|deleted|resolved|reviewed|invited|requested|banned|warned|erased)By$|^user_id$/i;

/** Keys whose value is free text, a device detail or a contact detail: dropped. */
const DROPPED_KEY =
  /^(?:description|text|content|body|comment|commentText|message|messages|note|notes|query|searchQuery|q|term|searchTerm|userAgent|user_agent|ua|email|emails|userEmail|displayName|firstName|lastName|fullName|userName|username|phone|ip|ipAddress|ip_address|address)$/i;

/** Keys holding a referrer: only its host is kept. */
const REFERRER_KEY = /^(?:referrer|referer|documentReferrer)$/i;

/** Keys holding a URL or path: query and fragment are dropped. */
const URL_KEY = /^(?:url|href|page|pageUrl|path|location|actionUrl|src)$/i;

/** An email-shaped token: something@something.tld (checked by index, no backtracking regex). */
function looksLikeEmail(token: string): boolean {
  const at = token.indexOf('@');
  const dot = token.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < token.length - 2;
}

/** Replaces email-shaped words in free text (linear: split on whitespace, check each word). */
function redactEmails(text: string): string {
  if (!text.includes('@')) return text;
  return text
    .split(/(\s+)/)
    .map((word) => (looksLikeEmail(word) ? '[email]' : word))
    .join('');
}

function isPseudonymous(value: string): boolean {
  return PSEUDONYM_VALUE.test(value) || value === ARCHIVE_ERASED_MARKER || value === ARCHIVE_ANONYMOUS_MARKER;
}

/** Every raw user id `scrubArchiveRecord` would replace, so their pseudonyms can be fetched first. */
export function collectArchiveUserIds(record: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown, personKey: boolean) => {
    if (typeof value === 'string') {
      if ((personKey && value && !isPseudonymous(value)) || USER_ID_VALUE.test(value)) ids.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, personKey);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (DROPPED_KEY.test(key)) continue;
        visit(inner, PERSON_ID_KEY.test(key));
      }
    }
  };
  visit(record, false);
  return ids;
}

export interface ScrubOptions {
  /** Raw user id -> pseudonym (or a marker). Ids missing from the map become the anonymous marker. */
  pseudonyms: ReadonlyMap<string, string>;
  /** Erasure messages: every person id becomes the erased marker, whatever the map says. */
  erased?: boolean;
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function withoutQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** A copy of `record` with person ids pseudonymised and free text dropped (see the module comment). */
export function scrubArchiveRecord<T>(record: T, options: ScrubOptions): T {
  const replaceId = (id: string) => {
    if (isPseudonymous(id)) return id;
    if (options.erased) return ARCHIVE_ERASED_MARKER;
    return options.pseudonyms.get(id) ?? ARCHIVE_ANONYMOUS_MARKER;
  };
  const visit = (value: unknown, key: string | null, personKey: boolean): unknown => {
    if (typeof value === 'string') {
      if ((personKey && value) || USER_ID_VALUE.test(value)) return replaceId(value);
      if (key && REFERRER_KEY.test(key)) return hostOf(value);
      const text = key && URL_KEY.test(key) ? withoutQuery(value) : value;
      return redactEmails(text);
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, key, personKey));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [inner, innerValue] of Object.entries(value)) {
        if (DROPPED_KEY.test(inner)) continue;
        out[inner] = visit(innerValue, inner, PERSON_ID_KEY.test(inner));
      }
      return out;
    }
    return value;
  };
  return visit(record, null, false) as T;
}

/** True when the record still holds something `scrubArchiveRecord` would change. */
export function archiveRecordNeedsScrub(record: unknown): boolean {
  if (record && typeof record === 'object' && (record as { privacy?: unknown }).privacy === ARCHIVE_PRIVACY_VERSION) return false;
  const probe = new Map<string, string>();
  for (const id of collectArchiveUserIds(record)) probe.set(id, `ps_${'0'.repeat(32)}`);
  return JSON.stringify(scrubArchiveRecord(record, { pseudonyms: probe })) !== JSON.stringify(record);
}

/** Created on use: some test environments (jsdom) have no TextEncoder when modules load. */
const encode = (text: string) => new TextEncoder().encode(text);

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `ps_` + the first 128 bits of HMAC-SHA-256(secret, userId), hex. */
export async function archivePseudonym(secret: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encode(userId));
  return `ps_${hex(mac).slice(0, 32)}`;
}

/** The secret store's key for a user: SHA-256 of the id, so the table holds no raw id. */
export async function archiveSubjectKey(userId: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encode(`archive-subject:${userId}`)));
}

/** A new random secret (256 bits, hex). */
export function newArchiveSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes.buffer);
}
