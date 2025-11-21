/**
 * Current Chapter Overlay Component
 *
 * Shows the current chapter title as an overlay on the video player.
 *
 * Features:
 * - Mobile-first responsive design
 * - Fade in when chapter changes
 * - Auto-hide after 3 seconds
 * - Show on hover over progress bar
 * - Configurable in player settings
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface CurrentChapterProps {
  chapter: VideoChapter | null;
  enabled?: boolean;
  autoHideDelay?: number;
  className?: string;
}

export function CurrentChapter({
  chapter,
  enabled = true,
  autoHideDelay = 3000,
  className = '',
}: CurrentChapterProps) {
  const { t, isRTL } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);
  const [previousChapterId, setPreviousChapterId] = useState<string | null>(null);

  // Show overlay when chapter changes
  useEffect(() => {
    if (!enabled || !chapter) {
      setIsVisible(false);
      return;
    }

    // Only show if chapter actually changed
    if (chapter.id !== previousChapterId) {
      setIsVisible(true);
      setPreviousChapterId(chapter.id);

      // Auto-hide after delay
      const hideTimer = setTimeout(() => {
        setIsVisible(false);
      }, autoHideDelay);

      return () => clearTimeout(hideTimer);
    }
  }, [chapter, previousChapterId, enabled, autoHideDelay]);

  // Show on hover (parent should handle this via prop)
  const handleMouseEnter = useCallback(() => {
    if (enabled && chapter) {
      setIsVisible(true);
    }
  }, [enabled, chapter]);

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
  }, []);

  if (!enabled || !chapter) {
    return null;
  }

  return (
    <div
      className={`
        absolute
        bottom-16
        ${isRTL ? 'right-4' : 'left-4'}
        z-30
        max-w-[calc(100%-2rem)]
        md:max-w-md
        pointer-events-none
        transition-all
        duration-300
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
        ${className}
      `}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="
          bg-black/90
          backdrop-blur-sm
          text-white
          px-4
          py-3
          md:px-5
          md:py-4
          rounded-lg
          shadow-2xl
          border
          border-white/10
        "
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Label */}
        <div className="
          text-xs
          md:text-sm
          text-gray-300
          mb-1
          flex
          items-center
          gap-2
        ">
          <span className="
            w-2
            h-2
            bg-primary
            rounded-full
            animate-pulse
          " />
          {t.video.currentChapter}
        </div>

        {/* Chapter Title */}
        <div className="
          text-sm
          md:text-base
          font-semibold
          line-clamp-2
          leading-snug
        ">
          {chapter.title}
        </div>
      </div>
    </div>
  );
}
