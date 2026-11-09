/**
 * Chapter Markers Component
 *
 * Visual markers on video progress bar showing chapter positions.
 *
 * Features:
 * - Mobile-first responsive design
 * - Chapter titles show in the progress bar's hover tooltip (VideoPlayer/ProgressTooltip)
 * - Click to seek to chapter
 * - Highlight current chapter marker
 * - Smooth animations
 */

'use client';

import { useCallback } from 'react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { getChapterTitle } from '@/lib/video/chapters';

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
  const { lang } = useLanguage();

  const handleMarkerClick = useCallback((e: React.MouseEvent, chapter: VideoChapter) => {
    e.stopPropagation();
    onSeek(chapter);
  }, [onSeek]);

  if (chapters.length === 0 || duration === 0) {
    return null;
  }

  // The progress bar runs left to right in both languages (docs/specs/VIDEO-PLAYER.md
  // section 5), so markers are placed from the left; chapter titles follow the language.
  return (
    <div className={`vjs-fanous-chapters ${className}`} dir="ltr" aria-hidden="true">
      {chapters.map((chapter) => {
        // The first chapter starts at 0:00 - a marker at the very start adds nothing
        if (chapter.startTime <= 0) return null;
        const position = Math.min(100, (chapter.startTime / duration) * 100);
        const title = getChapterTitle(chapter, lang);
        const isCurrent = currentChapter?.id === chapter.id;

        return (
          <button
            key={chapter.id}
            type="button"
            tabIndex={-1}
            onClick={(e) => handleMarkerClick(e, chapter)}
            className="vjs-fanous-chapter-mark"
            data-current={isCurrent || undefined}
            style={{ left: `${position}%` }}
            aria-label={`${formatTime(chapter.startTime)} ${title}`}
          />
        );
      })}
    </div>
  );
}
