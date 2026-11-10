/**
 * Real-time notification toasts: grouping, dedupe and the visible cap.
 *
 * A bulk upload pushes one `uploadReady` event per video within seconds. Each
 * used to open its own toast, so they piled up over the header and the open
 * account menu. Events of the same kind that arrive close together now merge
 * into one group ("3 videos finished processing"), repeats are dropped, and
 * only MAX_VISIBLE_GROUPS groups show at once; the rest collapse into "+N more".
 * Every notification still lands in the notification center: this only
 * decides what the toast region shows.
 *
 * Pure functions over plain data, so they are unit tested without React.
 */

import type { NotificationToastTranslations, PluralTexts } from '@al-ummah/shared-types';

/** Same-kind notifications arriving within this long of the group's latest one join it. */
export const GROUP_WINDOW_MS = 10_000;
/** A group stays this long after its latest notification (paused while hovered or focused). */
export const TOAST_TTL_MS = 8_000;
/** Groups shown at once; the rest collapse into "+N more". */
export const MAX_VISIBLE_GROUPS = 2;
/** Dedupe memory: ids/content keys of the most recent notifications. */
const SEEN_LIMIT = 200;

export interface ToastEntry {
  /** Server notification id (stable across redelivery) */
  id: string;
  /** Grouping kind: the notification key ("uploadReady") or, for legacy events, the type */
  kind: string;
  title: string;
  message: string;
  /** Locale-prefixed in-app URL, or null */
  href: string | null;
  /** Arrival time (ms since epoch) */
  at: number;
}

export interface ToastGroup {
  /** Id of the group's first entry; stable while the group lives */
  id: string;
  kind: string;
  entries: ToastEntry[];
  /** Arrival time of the newest entry; the group's timer runs from here */
  lastAt: number;
}

export interface ToastQueue {
  /** Newest group first */
  groups: ToastGroup[];
  /** Ids and content keys already shown (bounded, oldest dropped first) */
  seen: string[];
}

export const EMPTY_QUEUE: ToastQueue = { groups: [], seen: [] };

/** Identifies a repeat even when the server sends it again under a new id. */
export function contentKey(entry: Pick<ToastEntry, 'kind' | 'href' | 'message'>): string {
  return `${entry.kind}|${entry.href ?? ''}|${entry.message}`;
}

/**
 * Adds a notification. Returns the same queue object when it is a repeat (same
 * id, or same kind + target + text as one already shown), so callers can skip
 * a render.
 */
export function enqueueToast(queue: ToastQueue, entry: ToastEntry): ToastQueue {
  const content = contentKey(entry);
  if (queue.seen.includes(entry.id) || queue.seen.includes(content)) return queue;
  const seen = [...queue.seen, entry.id, content].slice(-SEEN_LIMIT);

  const index = queue.groups.findIndex((g) => g.kind === entry.kind && entry.at - g.lastAt <= GROUP_WINDOW_MS);
  if (index >= 0) {
    const group = queue.groups[index];
    const grown: ToastGroup = { ...group, entries: [...group.entries, entry], lastAt: Math.max(group.lastAt, entry.at) };
    // The group that just grew moves to the front, so it stays visible
    return { groups: [grown, ...queue.groups.filter((_, i) => i !== index)], seen };
  }
  return { groups: [{ id: entry.id, kind: entry.kind, entries: [entry], lastAt: entry.at }, ...queue.groups], seen };
}

export function dismissGroup(queue: ToastQueue, groupId: string): ToastQueue {
  const groups = queue.groups.filter((g) => g.id !== groupId);
  return groups.length === queue.groups.length ? queue : { ...queue, groups };
}

/** Drops groups whose latest notification is older than the TTL. */
export function expireGroups(queue: ToastQueue, now: number, ttl = TOAST_TTL_MS): ToastQueue {
  const groups = queue.groups.filter((g) => now - g.lastAt < ttl);
  return groups.length === queue.groups.length ? queue : { ...queue, groups };
}

/** After a pause (hover or focus), give every group back the time it was paused for. */
export function resumeGroups(queue: ToastQueue, pausedMs: number): ToastQueue {
  if (pausedMs <= 0 || queue.groups.length === 0) return queue;
  return { ...queue, groups: queue.groups.map((g) => ({ ...g, lastAt: g.lastAt + pausedMs })) };
}

export interface VisibleToasts {
  visible: ToastGroup[];
  /** Notifications in the collapsed groups */
  hiddenCount: number;
}

export function visibleToasts(queue: ToastQueue, cap = MAX_VISIBLE_GROUPS): VisibleToasts {
  const visible = queue.groups.slice(0, cap);
  const hiddenCount = queue.groups.slice(cap).reduce((n, g) => n + g.entries.length, 0);
  return { visible, hiddenCount };
}

/** CLDR plural form of `table` for `count`, with `{count}` as a localized number. */
export function pluralText(table: PluralTexts, count: number, lang: string): string {
  const form = new Intl.PluralRules(lang).select(count);
  const template = (count === 0 && table.zero) || table[form] || table.other;
  return template.replace(/\{count\}/g, new Intl.NumberFormat(lang).format(count));
}

const GROUPED_KINDS = ['uploadReady', 'uploadFailed', 'newComment', 'newSubscriber', 'newVideo', 'liveStarted', 'commentReply'] as const;
type GroupedKind = (typeof GROUPED_KINDS)[number];
const isGroupedKind = (kind: string): kind is GroupedKind => (GROUPED_KINDS as readonly string[]).includes(kind);

/** Upload results are reviewed in My Videos; everything else in the notification center. */
const UPLOAD_KINDS = new Set(['uploadReady', 'uploadFailed', 'upload']);

export interface GroupText {
  title: string;
  message: string;
  /** Where the action goes, or null for none */
  href: string | null;
  /** Action label: "View" for one notification, "View all" for several */
  action: string;
}

/** Title, message and action of a group in the viewer's language. */
export function groupText(group: ToastGroup, texts: NotificationToastTranslations, lang: string): GroupText {
  const [first] = group.entries;
  if (group.entries.length === 1) {
    return { title: first.title, message: first.message, href: first.href, action: texts.view };
  }
  const table = isGroupedKind(group.kind) ? texts.grouped[group.kind] : texts.grouped.other;
  const target = UPLOAD_KINDS.has(group.kind) ? '/dashboard/videos' : '/notifications';
  return {
    title: first.title,
    message: pluralText(table, group.entries.length, lang),
    href: `/${lang}${target}`,
    action: texts.viewAll,
  };
}

/**
 * Whether a notification is about something already on screen, so it shows no
 * toast (the page updates itself; the bell and notification center still get it):
 * upload results while on the upload page (its queue rows show the result,
 * FileQueueItem), and anything whose target is the current page.
 */
export function isAlreadyOnScreen(kind: string, href: string | null, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (href && href.split(/[?#]/)[0].replace(/\/+$/, '') === path) return true;
  if (!UPLOAD_KINDS.has(kind)) return false;
  return /^\/(en|ar)\/upload$/.test(path);
}
