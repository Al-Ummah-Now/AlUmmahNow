/**
 * Previous / next chapter controls under the watch-page player (Epic 8.1),
 * with the current chapter's title between them. Icons follow reading
 * direction (mirrored in RTL); the keyboard equivalent is Ctrl/Alt + arrow.
 */

'use client';

import type { VideoChapter } from '@al-ummah/shared-types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getChapterTitle } from '@/lib/video/chapters';

interface ChapterNavProps {
  chapters: VideoChapter[];
  currentChapterIndex: number;
  currentChapter: VideoChapter | null;
  onPrevious: () => void;
  onNext: () => void;
}

export function ChapterNav({ chapters, currentChapterIndex, currentChapter, onPrevious, onNext }: ChapterNavProps) {
  const { t, isRTL, lang } = useLanguage();
  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;
  // Before the first chapter there is no current one; "next" still goes to the first
  const hasNext = currentChapterIndex < chapters.length - 1;
  const hasPrevious = currentChapterIndex >= 0;
  const prevKeys = isRTL ? 'Control+ArrowRight Alt+ArrowRight' : 'Control+ArrowLeft Alt+ArrowLeft';
  const nextKeys = isRTL ? 'Control+ArrowLeft Alt+ArrowLeft' : 'Control+ArrowRight Alt+ArrowRight';
  const buttonClass =
    'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-sm font-medium ' +
    'text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-100 dark:hover:bg-gray-800 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

  return (
    <nav
      aria-label={t.video.chapters}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="chapter-nav"
      className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1 dark:bg-gray-900"
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasPrevious}
        aria-keyshortcuts={prevKeys}
        data-testid="chapter-previous"
        className={buttonClass}
      >
        <PrevIcon className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">{t.video.previousChapter}</span>
        <span className="sr-only sm:hidden">{t.video.previousChapter}</span>
      </button>
      <p className="min-w-0 flex-1 truncate text-center text-sm text-gray-700 dark:text-gray-300" aria-live="polite" data-testid="chapter-nav-current">
        {currentChapter ? (
          <>
            <span className="sr-only">{t.video.currentChapter}: </span>
            {getChapterTitle(currentChapter, lang)}
          </>
        ) : null}
      </p>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        aria-keyshortcuts={nextKeys}
        data-testid="chapter-next"
        className={buttonClass}
      >
        <span className="hidden sm:inline">{t.video.nextChapter}</span>
        <span className="sr-only sm:hidden">{t.video.nextChapter}</span>
        <NextIcon className="h-5 w-5" aria-hidden="true" />
      </button>
    </nav>
  );
}

export default ChapterNav;
