/**
 * Which video plays next outside a playlist (the owner's "auto play like youtube", 2026-11-11;
 * docs/specs/PLAYLIST-PLAYBACK.md phase 1b): the first video of the "Up next" list beside the
 * player that
 * - is not a video already watched in this tab's session, and
 * - has the same format as the one playing (a long video goes to a long video, a Short to a Short).
 * A numbered series wins over both: the API flags the next video of the playing video's series
 * (`seriesNext`, "Lesson 1" → "Lesson 2", never → "Lesson 11") and that one plays next.
 * The list is shown with that video first. In a playlist the playlist's order wins instead.
 */
import { isShortOrFlag } from '@al-ummah/shared-types';

interface FormatFields {
  id: string;
  isShort?: boolean;
  seriesNext?: boolean;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

const WATCHED_KEY = 'aun.watched.session';
const WATCHED_MAX = 200;

function session(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Videos watched in this tab (newest last). Storage can be missing or throw: then none. */
export function watchedThisSession(storage: Storage | undefined = session()): string[] {
  try {
    const raw = storage?.getItem(WATCHED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function recordWatched(videoId: string, storage: Storage | undefined = session()): void {
  try {
    const list = watchedThisSession(storage).filter((id) => id !== videoId);
    list.push(videoId);
    storage?.setItem(WATCHED_KEY, JSON.stringify(list.slice(-WATCHED_MAX)));
  } catch {
    // Without storage, repeats are only avoided within the related list itself
  }
}

const formatOf = (v: FormatFields) =>
  isShortOrFlag({ isShort: v.isShort, duration: v.duration ?? undefined, width: v.width ?? undefined, height: v.height ?? undefined } as never);

/**
 * The next video and the list in display order (next first). `next` is null when no related
 * video has the playing video's format: the end screen then offers Replay and suggestions only.
 */
export function pickUpNext<T extends FormatFields>(current: FormatFields, related: readonly T[], watched: readonly string[]): { next: T | null; ordered: T[] } {
  const seen = new Set(watched);
  const others = related.filter((v) => v.id !== current.id);
  const short = formatOf(current);
  const next = others.find((v) => v.seriesNext === true) ?? others.find((v) => !seen.has(v.id) && formatOf(v) === short) ?? null;
  return { next, ordered: next ? [next, ...others.filter((v) => v !== next)] : others };
}
