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
import { getChapterTitle } from '@/lib/video/chapters';

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
  const { t, isRTL, lang } = useLanguage();
  const [isVisible, setIsVisible] = useState(false);
  const [previousChapterId, setPreviousChapterId] = useState<string | null>(null);

  // Show overlay when chapter changes
  useEffect(() => {
    if (!enabled || !chapter) {
      setIsVisible(false);
      return undefined;
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

    return undefined;
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
      // Top end of the frame, clear of the control bar and the start-over pill (player-skin.css)
      className={`vjs-fanous-chapter-toast transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="vjs-fanous-chapter-toast-body"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Label */}
        <div className="vjs-fanous-chapter-toast-label">
          <span className="vjs-fanous-chapter-toast-dot" aria-hidden="true" />
          {t.video.currentChapter}
        </div>

        {/* Chapter Title */}
        <div className="vjs-fanous-chapter-toast-title">
          {getChapterTitle(chapter, lang)}
        </div>
      </div>
    </div>
  );
}
