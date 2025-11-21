/**
 * Chapter Markers Component
 *
 * Visual markers on video progress bar showing chapter positions.
 *
 * Features:
 * - Mobile-first responsive design
 * - Hover tooltips showing chapter titles
 * - Click to seek to chapter
 * - Highlight current chapter marker
 * - Smooth animations
 */

'use client';

import { useCallback } from 'react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface ChapterMarkersProps {
  chapters: VideoChapter[];
  currentChapter: VideoChapter | null;
  duration: number;
  onSeek: (chapter: VideoChapter) => void;
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

export function ChapterMarkers({
  chapters,
  currentChapter,
  duration,
  onSeek,
  className = '',
}: ChapterMarkersProps) {
  const { t, isRTL } = useLanguage();

  const handleMarkerClick = useCallback((e: React.MouseEvent, chapter: VideoChapter) => {
    e.stopPropagation();
    onSeek(chapter);
  }, [onSeek]);

  if (chapters.length === 0 || duration === 0) {
    return null;
  }

  return (
    <div
      className={`
        absolute
        inset-x-0
        bottom-0
        h-1
        pointer-events-none
        ${className}
      `}
      dir={isRTL ? 'rtl' : 'ltr'}
      role="group"
      aria-label={t.video.chapters}
    >
      {chapters.map((chapter) => {
        const position = (chapter.startTime / duration) * 100;
        const isCurrent = currentChapter?.id === chapter.id;

        return (
          <button
            key={chapter.id}
            type="button"
            onClick={(e) => handleMarkerClick(e, chapter)}
            className={`
              absolute
              top-0
              w-0.5
              md:w-1
              h-full
              pointer-events-auto
              cursor-pointer
              transition-all
              duration-200
              hover:scale-y-150
              hover:h-2
              group
              ${isCurrent
                ? 'bg-primary scale-y-150 h-2'
                : 'bg-white/60 hover:bg-white/90'
              }
            `}
            style={{
              [isRTL ? 'right' : 'left']: `${position}%`,
            }}
            aria-label={`${t.video.chapter}: ${chapter.title} (${formatTime(chapter.startTime)})`}
            title={chapter.title}
          >
            {/* Tooltip on hover - Desktop only */}
            <span
              className={`
                hidden
                md:block
                absolute
                bottom-full
                mb-2
                px-2
                py-1
                text-xs
                bg-black/90
                text-white
                rounded
                whitespace-nowrap
                opacity-0
                group-hover:opacity-100
                transition-opacity
                duration-200
                pointer-events-none
                ${isRTL ? 'right-0' : 'left-0'}
              `}
            >
              <span className="block font-semibold">
                {formatTime(chapter.startTime)}
              </span>
              <span className="block max-w-[200px] truncate">
                {chapter.title}
              </span>
              {/* Tooltip arrow */}
              <span
                className={`
                  absolute
                  top-full
                  w-0
                  h-0
                  border-4
                  border-transparent
                  border-t-black/90
                  ${isRTL ? 'right-2' : 'left-2'}
                `}
              />
            </span>

            {/* Touch-friendly marker (mobile) */}
            <span
              className={`
                md:hidden
                absolute
                -top-1
                -left-2
                w-4
                h-4
                rounded-full
                bg-white
                border-2
                ${isCurrent ? 'border-primary scale-125' : 'border-white/60'}
                transition-all
                duration-200
              `}
            />
          </button>
        );
      })}
    </div>
  );
}
