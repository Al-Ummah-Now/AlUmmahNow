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

import { useState, useEffect, useCallback, useRef } from 'react';
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
  // A ref, not state: setting state here re-ran the effect, whose cleanup cleared the hide timer,
  // so the toast never hid (it sat over the captions on a phone-width player)
  const shownChapterId = useRef<string | null>(null);

  // Show overlay when chapter changes, then hide it after the delay
  useEffect(() => {
    if (!enabled || !chapter) {
      setIsVisible(false);
      return undefined;
    }
    if (chapter.id === shownChapterId.current) return undefined;
    shownChapterId.current = chapter.id;
    setIsVisible(true);
    const hideTimer = setTimeout(() => setIsVisible(false), autoHideDelay);
    return () => clearTimeout(hideTimer);
  }, [chapter, enabled, autoHideDelay]);

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
