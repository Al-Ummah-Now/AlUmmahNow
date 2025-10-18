/**
 * Video Player Loading States
 *
 * Provides visual feedback during various loading operations:
 * - Buffering spinner with progress indicator
 * - Quality change notifications
 * - Smooth state transitions
 * - Accessible announcements
 *
 * Features:
 * - Backdrop blur for modern UI
 * - Animated spinners
 * - Progress percentage display
 * - Screen reader support
 * - No layout shift
 *
 * @example
 * ```tsx
 * <BufferingIndicator progress={bufferProgress} />
 * <QualityChangeIndicator from="720p" to="1080p" />
 * ```
 */

'use client';

import React from 'react';

export interface BufferingIndicatorProps {
  /**
   * Buffer progress percentage (0-100)
   * If undefined, shows indeterminate spinner
   */
  progress?: number;

  /**
   * Loading message (optional)
   */
  message?: string;

  /**
   * Language for accessibility
   */
  lang?: 'en' | 'ar';
}

/**
 * Buffering indicator with progress
 * Shows spinner and optional progress percentage
 */
export function BufferingIndicator({
  progress,
  message,
  lang = 'en',
}: BufferingIndicatorProps) {
  const bufferingText = lang === 'ar' ? 'جارٍ التخزين المؤقت...' : 'Buffering...';

  return (
    <div
      className="vjs-buffering-overlay"
      role="status"
      aria-live="polite"
      aria-label={message || bufferingText}
    >
      {/* Buffering spinner */}
      <div className="vjs-buffering-spinner">
        {progress !== undefined && progress > 0 && (
          <svg
            className="vjs-buffering-progress-ring"
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            <circle
              className="vjs-buffering-progress-bg"
              cx="50"
              cy="50"
              r="45"
            />
            <circle
              className="vjs-buffering-progress-fill"
              cx="50"
              cy="50"
              r="45"
              style={{
                strokeDashoffset: `${283 - (283 * progress) / 100}`,
              }}
            />
          </svg>
        )}
        {(progress === undefined || progress === 0) && (
          <div className="vjs-buffering-spinner-indeterminate" />
        )}
      </div>

      {/* Progress text */}
      {progress !== undefined && progress > 0 && (
        <div className="vjs-buffering-text" aria-live="polite">
          {Math.round(progress)}%
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="vjs-buffering-message">{message}</div>
      )}

      {/* Screen reader text */}
      <span className="sr-only">
        {message || bufferingText}
        {progress !== undefined && progress > 0 && ` ${Math.round(progress)}%`}
      </span>
    </div>
  );
}

export interface QualityChangeIndicatorProps {
  /**
   * Previous quality level
   */
  from: string;

  /**
   * New quality level
   */
  to: string;

  /**
   * Language for accessibility
   */
  lang?: 'en' | 'ar';
}

/**
 * Quality change indicator
 * Shows notification when video quality changes
 */
export function QualityChangeIndicator({
  from,
  to,
  lang = 'en',
}: QualityChangeIndicatorProps) {
  const switchingText = lang === 'ar' ? 'تبديل الجودة' : 'Switching quality';

  return (
    <div
      className="vjs-quality-change-indicator"
      role="status"
      aria-live="polite"
      aria-label={`${switchingText}: ${from} ${lang === 'ar' ? 'إلى' : 'to'} ${to}`}
    >
      <div className="vjs-quality-change-content">
        <div className="vjs-quality-change-icon">⚙️</div>
        <div className="vjs-quality-change-text">
          <div className="vjs-quality-change-label">{switchingText}</div>
          <div className="vjs-quality-change-values">
            {from} → {to}
          </div>
        </div>
      </div>

      {/* Screen reader text */}
      <span className="sr-only">
        {switchingText}: {from} {lang === 'ar' ? 'إلى' : 'to'} {to}
      </span>
    </div>
  );
}

export interface LoadingStateProps {
  /**
   * Current loading state
   */
  state: 'idle' | 'loading' | 'buffering' | 'quality-change' | 'error';

  /**
   * Buffer progress (0-100) for buffering state
   */
  bufferProgress?: number;

  /**
   * Quality change details
   */
  qualityChange?: {
    from: string;
    to: string;
  };

  /**
   * Error details
   */
  error?: {
    message: string;
    code?: string;
  };

  /**
   * Language for accessibility
   */
  lang?: 'en' | 'ar';
}

/**
 * Unified loading state manager
 * Displays appropriate indicator based on current state
 */
export function LoadingStateManager({
  state,
  bufferProgress,
  qualityChange,
  error,
  lang = 'en',
}: LoadingStateProps) {
  if (state === 'idle') {
    return null;
  }

  if (state === 'buffering') {
    return <BufferingIndicator progress={bufferProgress} lang={lang} />;
  }

  if (state === 'quality-change' && qualityChange) {
    return (
      <QualityChangeIndicator
        from={qualityChange.from}
        to={qualityChange.to}
        lang={lang}
      />
    );
  }

  if (state === 'loading') {
    return (
      <BufferingIndicator
        message={lang === 'ar' ? 'جارٍ التحميل...' : 'Loading video...'}
        lang={lang}
      />
    );
  }

  if (state === 'error' && error) {
    return (
      <div className="vjs-loading-error" role="alert">
        <div className="vjs-loading-error-icon">⚠️</div>
        <div className="vjs-loading-error-message">{error.message}</div>
        {error.code && (
          <div className="vjs-loading-error-code">Error: {error.code}</div>
        )}
      </div>
    );
  }

  return null;
}
