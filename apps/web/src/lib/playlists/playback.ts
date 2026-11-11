/**
 * Playlist playback on the watch page (docs/specs/PLAYLIST-PLAYBACK.md): the
 * URL model, the next/previous rules with loop and shuffle, and the viewer's
 * playback preferences. Pure, apart from the guarded storage helpers.
 *
 * URL: /{locale}/video/{videoId}?list={listId}&index={n}&t={time}
 * - `list`: a playlist id, or WL / LL (the viewer's Watch later / Liked videos)
 * - `index`: the item's place in the stored list, 0-based (the embed contract's meaning)
 */

/** Private list aliases (resolved per viewer by the API; never shared). */
export const LIST_ALIASES = ['WL', 'LL'] as const;
export type ListAlias = (typeof LIST_ALIASES)[number];

const LIST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_INDEX = 100_000;

export interface ListParams {
  list: string;
  /** null when the URL has none or an invalid one */
  index: number | null;
}

export function isListAlias(list: string | null | undefined): list is ListAlias {
  return list === 'WL' || list === 'LL';
}

/** `list` and `index` from the watch URL; null when there is no usable list. */
export function parseListParams(params: { get(name: string): string | null } | null | undefined): ListParams | null {
  const list = params?.get('list')?.trim();
  if (!list || !LIST_ID.test(list)) return null;
  const raw = params?.get('index');
  const n = raw != null && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  return { list, index: Number.isInteger(n) && n >= 0 && n <= MAX_INDEX ? n : null };
}

/** The watch URL of a video, inside a list when one is given. */
export function watchHref(locale: string, videoId: string, opts: { list?: string | null; index?: number | null; t?: number | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.list) {
    q.set('list', opts.list);
    if (opts.index != null && opts.index >= 0) q.set('index', String(opts.index));
  }
  if (opts.t && opts.t >= 1) q.set('t', String(Math.floor(opts.t)));
  const query = q.toString();
  return `/${locale}/video/${encodeURIComponent(videoId)}${query ? `?${query}` : ''}`;
}

/** A shareable URL keeps public lists and drops the viewer's private aliases. */
export function shareableList(list: string | null | undefined): string | null {
  return list && !isListAlias(list) ? list : null;
}

/** Deterministic Fisher-Yates over positions 0..total-1 (mulberry32), the current position first. */
export function shuffledOrder(total: number, seed: number, first: number | null): number[] {
  const order = Array.from({ length: Math.max(0, total) }, (_, i) => i);
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (first !== null && first >= 0 && first < total) {
    const at = order.indexOf(first);
    order.splice(at, 1);
    order.unshift(first);
  }
  return order;
}

export interface StepInput {
  /** Visible position of the playing video, or null when it is not in the list */
  position: number | null;
  /** The position that follows when the video is not in the list (from the API) */
  nextPosition?: number | null;
  total: number;
  loop: boolean;
  /** Shuffled positions (shuffle on), or null for the saved order */
  shuffle: number[] | null;
}

/**
 * The position to play after the current one, or null at the end of the list
 * (playback stops unless loop is on, D9).
 */
export function nextPosition({ position, nextPosition: after, total, loop, shuffle }: StepInput): number | null {
  if (total <= 0) return null;
  if (position === null) {
    if (after != null && after >= 0 && after < total) return after;
    return loop ? 0 : null;
  }
  if (shuffle && shuffle.length === total) {
    const at = shuffle.indexOf(position);
    if (at === -1) return shuffle[0] ?? null;
    if (at + 1 < shuffle.length) return shuffle[at + 1];
    return loop ? shuffle[0] : null;
  }
  if (position + 1 < total) return position + 1;
  return loop ? 0 : null;
}

/** The position before the current one (wraps only with loop), or null. */
export function previousPosition({ position, total, loop, shuffle }: StepInput): number | null {
  if (total <= 0 || position === null) return null;
  if (shuffle && shuffle.length === total) {
    const at = shuffle.indexOf(position);
    if (at > 0) return shuffle[at - 1];
    return loop ? shuffle[shuffle.length - 1] : null;
  }
  if (position > 0) return position - 1;
  return loop ? total - 1 : null;
}

// ---------------------------------------------------------------------------
// Preferences. Storage can be missing or throw (private mode, blocked site data):
// every access is guarded and the defaults apply.
// ---------------------------------------------------------------------------

const AUTOPLAY_NEXT_KEY = 'aun.player.autoplayNext';
const PANE_COLLAPSED_KEY = 'aun.playlist.paneCollapsed';
const LIST_MODE_PREFIX = 'aun.playlist.mode.';

function local(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function session(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Only the preference is lost
  }
}

/** "Autoplay next" (D8): per device, on by default. */
export function readAutoplayNext(storage: Storage | undefined = local()): boolean {
  return read(storage, AUTOPLAY_NEXT_KEY) !== '0';
}

export function writeAutoplayNext(on: boolean, storage: Storage | undefined = local()): void {
  write(storage, AUTOPLAY_NEXT_KEY, on ? '1' : '0');
}

export function readPaneCollapsed(fallback: boolean, storage: Storage | undefined = local()): boolean {
  const v = read(storage, PANE_COLLAPSED_KEY);
  return v === null ? fallback : v === '1';
}

export function writePaneCollapsed(on: boolean, storage: Storage | undefined = local()): void {
  write(storage, PANE_COLLAPSED_KEY, on ? '1' : '0');
}

export interface ListMode {
  loop: boolean;
  /** Seed of the tab's shuffle, or null when shuffle is off */
  shuffleSeed: number | null;
  /** The position playing when shuffle was turned on (it leads the shuffled order) */
  shuffleFirst: number | null;
}

/** Loop and shuffle: per tab and list, never in the URL (D4). */
export function readListMode(list: string, storage: Storage | undefined = session()): ListMode {
  const raw = read(storage, LIST_MODE_PREFIX + list);
  const off: ListMode = { loop: false, shuffleSeed: null, shuffleFirst: null };
  if (!raw) return off;
  try {
    const v = JSON.parse(raw) as Partial<ListMode>;
    return {
      loop: v.loop === true,
      shuffleSeed: typeof v.shuffleSeed === 'number' ? v.shuffleSeed : null,
      shuffleFirst: typeof v.shuffleFirst === 'number' ? v.shuffleFirst : null,
    };
  } catch {
    return off;
  }
}

export function writeListMode(list: string, mode: ListMode, storage: Storage | undefined = session()): void {
  write(storage, LIST_MODE_PREFIX + list, JSON.stringify(mode));
}
