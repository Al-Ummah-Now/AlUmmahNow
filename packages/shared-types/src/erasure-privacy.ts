/**
 * What an account erasure leaves behind in records that are kept on purpose (#1253, #1254, #1255).
 *
 * - Placeholders: an erased person's names and emails become "erased user", their video titles
 *   "erased video", their channel names "erased channel" (admin history, the queue-message archive).
 *   Ids become the erased marker `deleted-user` (the value every other erasure step writes).
 * - Hashed user ids: stores that keep a message for debugging only (the processor's dead letters)
 *   keep `uh_<hex>` (SHA-256 of the id) instead of the raw id.
 * - Erase tombstones: the erased account's key (SHA-256 of the id, never the id) is kept for a short
 *   while, so writes that arrive after the erasure (an error report from a page that was still open)
 *   are anonymised at write time.
 * - Archive titles: which keys of an archived message hold a creator's titles and channel names,
 *   whose erasure replaces them, and the replacement itself.
 *
 * Pure apart from the SHA-256 helpers (Web Crypto), so the processor, api-videos and admin-api apply
 * the same rules.
 */

/** Id marker of an erased person (same value as the archive's ARCHIVE_ERASED_MARKER). */
export const ERASED_USER_ID = 'deleted-user';

export const ERASED_USER_LABEL = 'erased user';
export const ERASED_VIDEO_LABEL = 'erased video';
export const ERASED_CHANNEL_LABEL = 'erased channel';
export const ERASED_PLAYLIST_LABEL = 'erased playlist';

/** How long an erase tombstone is kept: late writes come from pages that were still open. */
export const ERASE_TOMBSTONE_RETENTION_DAYS = 30;

/** Admin history (admin_deletions, finished admin_jobs) is kept this long, then purged (#1253). */
export const ADMIN_HISTORY_RETENTION_DAYS = 730;

const USER_ID_VALUE = /^usr_[0-9a-f]{32}$/;
const HASHED_USER_ID_VALUE = /^uh_[0-9a-f]{32}$/;

/** Keys whose value is a person's id (or a list of them); same rule as the archive (archive-privacy). */
const PERSON_ID_KEY =
  /^(?:[a-z]*?)(?:user|viewer|reporter|owner|author|actor|profile|subscriber|member|recipient|resolver|moderator|reviewer|admin|uploader|creator|voter|liker|inviter|target(?=User))(?:User)?Ids?$|^(?:created|updated|deleted|resolved|reviewed|invited|requested|banned|warned|erased)By$|^user_id$/i;

export function isPersonIdKey(key: string): boolean {
  return PERSON_ID_KEY.test(key);
}

const MARKERS = new Set([ERASED_USER_ID, 'anonymous', 'system', '']);

function isPersonValue(value: string, personKey: boolean): boolean {
  if (USER_ID_VALUE.test(value)) return true;
  return personKey && !MARKERS.has(value) && !HASHED_USER_ID_VALUE.test(value) && !value.startsWith('ps_');
}

/** Every person id in `record`: `usr_…` values anywhere, and the values of person-id keys. */
export function collectPersonIds(record: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown, personKey: boolean) => {
    if (typeof value === 'string') {
      if (isPersonValue(value, personKey)) ids.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, personKey);
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) visit(inner, isPersonIdKey(key));
    }
  };
  visit(record, false);
  return ids;
}

/** A copy of `record` with every person id (as `collectPersonIds` finds them) replaced through `map`; nothing else changes. */
export function replacePersonIds<T>(record: T, map: ReadonlyMap<string, string>): T {
  const visit = (value: unknown, personKey: boolean): unknown => {
    if (typeof value === 'string') return isPersonValue(value, personKey) ? (map.get(value) ?? value) : value;
    if (Array.isArray(value)) return value.map((item) => visit(item, personKey));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = visit(inner, isPersonIdKey(key));
      return out;
    }
    return value;
  };
  return visit(record, false) as T;
}

const encode = (text: string) => new TextEncoder().encode(text);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `uh_` + the first 128 bits of SHA-256 of the id: the same person gets the same value, the id is not kept. */
export async function hashedUserId(userId: string): Promise<string> {
  return `uh_${(await sha256Hex(`user:${userId}`)).slice(0, 32)}`;
}

/** A copy of `record` with every person id hashed (`hashedUserId`); `changed` says whether any was. */
export async function hashPersonIds<T>(record: T): Promise<{ record: T; changed: boolean }> {
  const ids = collectPersonIds(record);
  if (ids.size === 0) return { record, changed: false };
  const map = new Map<string, string>();
  for (const id of ids) map.set(id, await hashedUserId(id));
  return { record: replacePersonIds(record, map), changed: true };
}

/** Free text with every `usr_…` id in it hashed (`hashedUserId`). */
export async function hashUserIdsInText(text: string): Promise<string> {
  const ids = [...new Set(text.match(/usr_[0-9a-f]{32}/g) ?? [])];
  let out = text;
  for (const id of ids) out = out.split(id).join(await hashedUserId(id));
  return out;
}

/** The erase tombstone's key for a user (REPORTS_DB erased_users): SHA-256 of the id, hex. */
export async function eraseTombstoneKey(userId: string): Promise<string> {
  return sha256Hex(`erased-user:${userId}`);
}

/** Placeholder title of an admin deletion's item once its owner is erased ("erased video", "erased channel"...). */
export function erasedTitleOf(kind: string): string {
  return `erased ${kind}`;
}

// ---------------------------------------------------------------------------
// Archive titles (#1254)
// ---------------------------------------------------------------------------

/** customMetadata `titles` of an archived object whose titles are indexed (or already placeholders). */
export const ARCHIVE_TITLES_VERSION = 'titles-indexed-v1';

/**
 * Keys holding a title of someone's content: `title`, `videoTitle`, `streamTitle`, `playlistTitle`,
 * per language (`videoTitle_ar`) or as a language map (`titleLocalized`).
 */
const TITLE_KEY = /^(?:title|[a-z][A-Za-z0-9]*Title)(?:_[A-Za-z-]+|Localized)?$/;
/** Keys holding a channel's name as the archive keeps it (`channelName` itself is dropped as free text). */
const CHANNEL_NAME_KEY = /^channelName(?:_[A-Za-z-]+|Localized)$/;

function titleLabelOf(key: string): string | null {
  if (CHANNEL_NAME_KEY.test(key) || /^channelTitle/.test(key)) return ERASED_CHANNEL_LABEL;
  if (!TITLE_KEY.test(key)) return null;
  return /^playlist/.test(key) ? ERASED_PLAYLIST_LABEL : ERASED_VIDEO_LABEL;
}

/** True when the record holds a content title or channel name not yet replaced by its placeholder. */
export function hasArchiveTitles(record: unknown): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    for (const [key, inner] of Object.entries(value)) {
      const label = titleLabelOf(key);
      if (label) {
        if (JSON.stringify(eraseValue(label, inner)) !== JSON.stringify(inner)) return true;
      } else if (visit(inner)) return true;
    }
    return false;
  };
  return visit(record);
}

function eraseValue(label: string, value: unknown): unknown {
  if (typeof value === 'string') return value ? label : value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' && v ? label : v]));
  }
  return value;
}

/** A copy of `record` with every content title and channel name replaced by its placeholder. */
export function eraseArchiveTitles<T>(record: T): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const label = titleLabelOf(key);
      out[key] = label ? eraseValue(label, inner) : visit(inner);
    }
    return out;
  };
  return visit(record) as T;
}

/**
 * Whose erasure scrubs the titles of an archived message: the people the titled content belongs to,
 * or who were told about it. Owner-like person keys (videoOwnerId, ownerId, creatorId, authorId,
 * actorUserId, recipientUserId...) anywhere, and the payload's own `userId` (uploads, edits: the
 * creator acting on their content). Viewers, reporters and push recipient lists are not owners.
 * Empty when the message carries no title.
 */
const OWNER_KEY = /^(?:[a-z]*?)(?:owner|author|actor|uploader|creator|recipient)(?:User)?Id$/i;

export function archiveTitleOwnerIds(message: unknown): Set<string> {
  const owners = new Set<string>();
  if (!hasArchiveTitles(message)) return owners;
  const add = (value: unknown) => {
    if (typeof value === 'string' && value && !MARKERS.has(value) && !value.startsWith('ps_')) owners.add(value);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (OWNER_KEY.test(key)) add(inner);
      else visit(inner);
    }
  };
  visit(message);
  const payload = (message as { payload?: { userId?: unknown } } | null)?.payload;
  if (payload && typeof payload === 'object') add(payload.userId);
  return owners;
}
