/**
 * ViewerCount Component
 *
 * Displays real-time viewer count for videos with WebSocket integration.
 * Supports both live streams (with live indicator) and regular videos.
 * Bilingual support for English and Arabic with proper RTL handling.
 *
 * Features:
 * - Live indicator for live streams (red dot + "LIVE" text)
 * - Animated viewer count with number formatting
 * - Connection status indicator
 * - Graceful degradation (shows nothing if count is 0 or not connected)
 * - Accessibility support with ARIA labels
 * - Responsive design
 */

'use client';

import { useEffect, useState } from 'react';

export interface ViewerCountProps {
  count: number;
  isLive?: boolean;
  isConnected?: boolean;
  lang?: 'en' | 'ar';
  showWhenDisconnected?: boolean;
  className?: string;
}

/**
 * Format number with locale-specific formatting
 */
function formatViewerCount(count: number, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';

  // For large numbers, use compact notation
  if (count >= 1000) {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1
    }).format(count);
  }

  // For smaller numbers, use standard formatting
  return count.toLocaleString(locale);
}

/**
 * ViewerCount component
 */
export function ViewerCount({
  count,
  isLive = false,
  isConnected = true,
  lang = 'en',
  showWhenDisconnected = false,
  className = ''
}: ViewerCountProps): JSX.Element | null {
  const [displayCount, setDisplayCount] = useState(count);
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate count changes
  useEffect(() => {
    if (count !== displayCount) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayCount(count);
        setIsAnimating(false);
      }, 150);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [count, displayCount]);

  // Don't show if not connected (unless showWhenDisconnected is true)
  if (!isConnected && !showWhenDisconnected) {
    return null;
  }

  // Don't show if count is 0
  if (count === 0) {
    return null;
  }

  const formattedCount = formatViewerCount(displayCount, lang);
  const viewersText = lang === 'ar' ? 'مشاهد' : 'viewers';
  const liveText = lang === 'ar' ? 'مباشر' : 'LIVE';
  const watchingText = lang === 'ar' ? 'يشاهدون الآن' : 'watching now';

  const ariaLabel = lang === 'ar'
    ? `${formattedCount} ${isLive ? 'مشاهد مباشر' : 'مشاهد'}`
    : `${formattedCount} ${isLive ? 'live viewers' : 'viewers'}`;

  return (
    <div
      className={`vjs-viewer-count-overlay vjs-viewer-count${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Live indicator (if applicable) */}
      {isLive && (
        <span className="vjs-live-indicator" aria-label={liveText}>
          <span className="vjs-live-dot" aria-hidden="true" />
          <span className="vjs-live-text">{liveText}</span>
        </span>
      )}

      {/* Viewer count */}
      <span
        className={`vjs-viewer-count-text ${isAnimating ? 'vjs-viewer-count-animating' : ''}`}
        aria-label={ariaLabel}
      >
        <span className="vjs-viewer-count-number">{formattedCount}</span>
        <span className="vjs-viewer-count-label">
          {isLive ? watchingText : viewersText}
        </span>
      </span>

      {/* Connection status indicator (subtle, only shown when disconnected) */}
      {!isConnected && showWhenDisconnected && (
        <span
          className="vjs-viewer-count-disconnected"
          aria-label={lang === 'ar' ? 'غير متصل' : 'Disconnected'}
          title={lang === 'ar' ? 'غير متصل بالخادم' : 'Not connected to server'}
        >
          <span className="vjs-disconnected-icon" aria-hidden="true">⚠</span>
        </span>
      )}
    </div>
  );
}
