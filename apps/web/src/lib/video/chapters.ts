/**
 * Chapter helpers for the watch page.
 */

import type { VideoChapter } from '@al-ummah/shared-types';

/**
 * Sort chapters by start time and make every chapter's end time usable:
 * chapters parsed before the video duration was known can have endTime 0
 * (or <= startTime). Those end at the next chapter's start, or at the video
 * duration for the last chapter (Infinity until the duration is known).
 */
export function normalizeChapters(chapters: VideoChapter[] | undefined | null, duration?: number): VideoChapter[] {
  if (!Array.isArray(chapters) || chapters.length === 0) return [];

  const sorted = chapters
    .filter((ch) => ch && Number.isFinite(ch.startTime) && ch.startTime >= 0)
    .slice()
    .sort((a, b) => a.startTime - b.startTime);

  const knownDuration = duration && Number.isFinite(duration) && duration > 0 ? duration : undefined;

  return sorted.map((chapter, index) => {
    const next = sorted[index + 1];
    const fallbackEnd = next ? next.startTime : (knownDuration ?? Number.POSITIVE_INFINITY);
    const endTime = chapter.endTime > chapter.startTime ? chapter.endTime : fallbackEnd;
    return { ...chapter, endTime };
  });
}

/**
 * Find the chapter that contains `time`.
 */
export function findChapterAt(chapters: VideoChapter[], time: number): VideoChapter | null {
  if (!Number.isFinite(time)) return null;
  return chapters.find((ch) => time >= ch.startTime && time < ch.endTime) || null;
}

/**
 * Localized chapter title (falls back to the default title).
 */
export function getChapterTitle(chapter: VideoChapter, locale: string): string {
  const localized = chapter.titleLocalized?.[locale as 'en' | 'ar'];
  return localized || chapter.title;
}

/** Seconds into a chapter after which "previous" restarts it instead of going back one. */
export const RESTART_CHAPTER_AFTER_SECONDS = 3;

/**
 * Chapter to seek to for previous/next (Epic 8.1). Chapters are sorted by
 * start time (normalizeChapters).
 * - next: the first chapter starting after `time` (also from before the first chapter).
 * - previous: the current chapter when more than 3 s into it, otherwise the one before.
 * Null when there is nowhere to go.
 */
export function adjacentChapter(
  chapters: VideoChapter[],
  time: number,
  direction: 'next' | 'previous',
): VideoChapter | null {
  if (!chapters.length || !Number.isFinite(time)) return null;
  if (direction === 'next') {
    return chapters.find((ch) => ch.startTime > time + 0.25) || null;
  }
  const index = chapters.findIndex((ch) => time >= ch.startTime && time < ch.endTime);
  if (index === -1) {
    // Past the end of the last chapter: go to it; before the first: nowhere
    const last = chapters[chapters.length - 1];
    return time >= last.endTime ? last : null;
  }
  if (time - chapters[index].startTime > RESTART_CHAPTER_AFTER_SECONDS) return chapters[index];
  return index > 0 ? chapters[index - 1] : chapters[index];
}

/**
 * Keyboard shortcut for chapter navigation: Ctrl or Alt with a horizontal
 * arrow (Ctrl+Arrow is the common player convention; Alt for macOS, where
 * Ctrl+Arrow switches desktops). Arrows follow reading direction, so in RTL
 * ArrowLeft is "next", like the seek arrows.
 */
export function chapterShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>,
  rtl: boolean,
): 'next' | 'previous' | null {
  if (!(event.ctrlKey || event.altKey) || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowRight') return rtl ? 'previous' : 'next';
  if (event.key === 'ArrowLeft') return rtl ? 'next' : 'previous';
  return null;
}
