/**
 * Chapter List Component
 *
 * Collapsible panel showing all video chapters.
 *
 * Features:
 * - Mobile-first responsive design (drawer on mobile, side panel on desktop)
 * - Highlight current chapter
 * - Click to seek to chapter
 * - Keyboard navigation (up/down arrows)
 * - Auto-scroll to current chapter
 * - Empty state when no chapters
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { ChevronUp, List, X } from 'lucide-react';

interface ChapterListProps {
  chapters: VideoChapter[];
  currentChapter: VideoChapter | null;
  currentChapterIndex: number;
  onSeek: (chapter: VideoChapter) => void;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function ChapterList({
  chapters,
  currentChapter,
  currentChapterIndex,
  onSeek,
  isOpen,
  onToggle,
  className = '',
}: ChapterListProps) {
  const { t, isRTL } = useLanguage();
  const currentChapterRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current chapter
  useEffect(() => {
    if (isOpen && currentChapterRef.current && listRef.current) {
      currentChapterRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentChapter, isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || chapters.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = Math.min(currentChapterIndex + 1, chapters.length - 1);
      if (nextIndex !== currentChapterIndex) {
        onSeek(chapters[nextIndex]);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = Math.max(currentChapterIndex - 1, 0);
      if (prevIndex !== currentChapterIndex) {
        onSeek(chapters[prevIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onToggle();
    }
  }, [isOpen, chapters, currentChapterIndex, onSeek, onToggle]);

  const handleChapterClick = useCallback((chapter: VideoChapter) => {
    onSeek(chapter);
  }, [onSeek]);

  if (chapters.length === 0) {
    return null;
  }

  return (
    <>
      {/* Toggle Button */}
      <button
        type="button"
        onClick={onToggle}
        className={`
          fixed
          ${isRTL ? 'left-4' : 'right-4'}
          bottom-24
          md:bottom-32
          z-50
          w-12
          h-12
          md:w-14
          md:h-14
          bg-black/80
          backdrop-blur-sm
          text-white
          rounded-full
          flex
          items-center
          justify-center
          transition-all
          duration-200
          hover:bg-black/90
          hover:scale-110
          active:scale-95
          shadow-lg
          ${className}
        `}
        aria-label={isOpen ? t.video.hideChapters : t.video.showChapters}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <List className="w-6 h-6" />
        )}
        {chapters.length > 0 && !isOpen && (
          <span
            className="
              absolute
              -top-1
              -right-1
              w-5
              h-5
              bg-primary
              text-white
              text-xs
              rounded-full
              flex
              items-center
              justify-center
            "
          >
            {chapters.length}
          </span>
        )}
      </button>

      {/* Chapter List Panel */}
      {isOpen && (
        <>
          {/* Backdrop (mobile) */}
          <div
            className="
              fixed
              inset-0
              bg-black/60
              backdrop-blur-sm
              z-40
              md:hidden
            "
            onClick={onToggle}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            ref={listRef}
            className={`
              fixed
              z-40
              bg-white
              dark:bg-gray-900
              shadow-2xl
              transition-all
              duration-300
              ${isRTL ? 'left-0' : 'right-0'}

              /* Mobile: Bottom drawer */
              bottom-0
              w-full
              max-h-[70vh]
              rounded-t-2xl

              /* Desktop: Side panel */
              md:top-20
              md:bottom-auto
              md:w-96
              md:max-h-[600px]
              md:rounded-l-2xl
              md:rounded-tr-none
            `}
            onKeyDown={handleKeyDown}
            role="navigation"
            aria-label={t.video.chapterList}
            tabIndex={0}
          >
            {/* Header */}
            <div className="
              flex
              items-center
              justify-between
              p-4
              border-b
              border-gray-200
              dark:border-gray-700
              sticky
              top-0
              bg-white
              dark:bg-gray-900
              z-10
            ">
              <div className="flex items-center gap-2">
                <List className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                <h3 className="font-semibold text-lg text-gray-900 dark:text-white">
                  {t.video.chapters}
                </h3>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  ({chapters.length})
                </span>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="
                  p-2
                  rounded-full
                  hover:bg-gray-100
                  dark:hover:bg-gray-800
                  transition-colors
                "
                aria-label={t.common.close}
              >
                <ChevronUp className="w-5 h-5" />
              </button>
            </div>

            {/* Chapter List */}
            <div className="
              overflow-y-auto
              max-h-[calc(70vh-4rem)]
              md:max-h-[536px]
            ">
              {chapters.map((chapter, index) => {
                const isCurrent = currentChapter?.id === chapter.id;

                return (
                  <button
                    key={chapter.id}
                    ref={isCurrent ? currentChapterRef : null}
                    type="button"
                    onClick={() => handleChapterClick(chapter)}
                    className={`
                      w-full
                      text-left
                      p-4
                      flex
                      gap-3
                      items-start
                      transition-all
                      duration-200
                      border-b
                      border-gray-100
                      dark:border-gray-800
                      last:border-b-0
                      ${isCurrent
                        ? 'bg-primary/10 dark:bg-primary/20 border-l-4 border-l-primary'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }
                    `}
                    dir={isRTL ? 'rtl' : 'ltr'}
                  >
                    {/* Timestamp */}
                    <span
                      className={`
                        flex-shrink-0
                        font-mono
                        text-sm
                        md:text-base
                        ${isCurrent
                          ? 'text-primary font-semibold'
                          : 'text-gray-600 dark:text-gray-400'
                        }
                      `}
                    >
                      {formatTime(chapter.startTime)}
                    </span>

                    {/* Title */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`
                          text-sm
                          md:text-base
                          line-clamp-2
                          ${isCurrent
                            ? 'text-gray-900 dark:text-white font-semibold'
                            : 'text-gray-700 dark:text-gray-200'
                          }
                        `}
                      >
                        {chapter.title}
                      </p>
                      {isCurrent && (
                        <span className="
                          text-xs
                          text-primary
                          mt-1
                          block
                        ">
                          {t.video.currentChapter}
                        </span>
                      )}
                    </div>

                    {/* Chapter number */}
                    <span className="
                      flex-shrink-0
                      text-xs
                      text-gray-400
                      dark:text-gray-500
                    ">
                      {index + 1}/{chapters.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
