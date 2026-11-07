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
