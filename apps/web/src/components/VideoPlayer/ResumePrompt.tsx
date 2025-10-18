/**
 * Resume Playback Prompt Component
 *
 * Modal that prompts users to resume playback from a saved position or start from the beginning.
 *
 * Features:
 * - Shows video thumbnail, title, and saved timestamp
 * - Auto-resume after 3 seconds (configurable)
 * - Dismissible with ESC key or click outside
 * - Bilingual support (EN/AR)
 * - Mobile-friendly design
 * - Accessibility compliant
 *
 * Issue #58: Resume Playback UI
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export interface ResumePromptProps {
  /**
   * Video title to display
   */
  videoTitle: string;

  /**
   * Saved playback position in seconds
   */
  savedTime: number;

  /**
   * Total video duration in seconds
   */
  duration: number;

  /**
   * Optional thumbnail URL
   */
  thumbnailUrl?: string;

  /**
   * Callback when user clicks "Resume"
   */
  onResume: () => void;

  /**
   * Callback when user clicks "Start from Beginning"
   */
  onStartFromBeginning: () => void;

  /**
   * Callback when prompt is dismissed
   */
  onDismiss: () => void;

  /**
   * Auto-resume countdown duration in seconds (default: 3)
   */
  autoResumeSeconds?: number;

  /**
   * Language for bilingual support
   */
  lang?: 'en' | 'ar';
}

/**
 * Format seconds to MM:SS or HH:MM:SS format
 */
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Resume Playback Prompt Component
 */
export function ResumePrompt({
  videoTitle,
  savedTime,
  duration,
  thumbnailUrl,
  onResume,
  onStartFromBeginning,
  onDismiss,
  autoResumeSeconds = 3,
  lang = 'en',
}: ResumePromptProps): JSX.Element {
  const { t, isRTL, dir } = useVideoPlayerI18n(lang);
  const [countdown, setCountdown] = useState(autoResumeSeconds);
  const modalRef = useRef<HTMLDivElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Format saved time for display
  const formattedTime = formatTime(savedTime);

  // Calculate progress percentage
  const progressPercentage = duration > 0 ? (savedTime / duration) * 100 : 0;

  /**
   * Auto-resume countdown
   */
  useEffect(() => {
    // Focus resume button on mount for accessibility
    if (resumeButtonRef.current) {
      resumeButtonRef.current.focus();
    }

    // Start countdown timer
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Countdown finished - auto-resume
          onResume();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [onResume]);

  /**
   * Handle ESC key press
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    },
    [onDismiss]
  );

  /**
   * Handle backdrop click (click outside modal)
   */
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onDismiss();
      }
    },
    [onDismiss]
  );

  /**
   * Register ESC key listener
   */
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  /**
   * Handle resume button click
   */
  const handleResume = useCallback(() => {
    // Clear countdown timer
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    onResume();
  }, [onResume]);

  /**
   * Handle start over button click
   */
  const handleStartOver = useCallback(() => {
    // Clear countdown timer
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    onStartFromBeginning();
  }, [onStartFromBeginning]);

  return (
    <div
      className="vjs-resume-prompt-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-prompt-title"
      aria-describedby="resume-prompt-description"
      dir={dir}
    >
      <div
        ref={modalRef}
        className="vjs-resume-prompt-modal"
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="vjs-resume-prompt-close"
          aria-label={t.keyboard.closeButton}
          type="button"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Content container */}
        <div className="vjs-resume-prompt-content">
          {/* Thumbnail and title */}
          <div className="vjs-resume-prompt-header">
            {thumbnailUrl && (
              <div className="vjs-resume-prompt-thumbnail">
                <img
                  src={thumbnailUrl}
                  alt={videoTitle}
                  loading="lazy"
                />
                {/* Progress indicator overlay */}
                <div className="vjs-resume-prompt-thumbnail-progress">
                  <div
                    className="vjs-resume-prompt-thumbnail-progress-bar"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
            )}
            <div className="vjs-resume-prompt-title-container">
              <h2 id="resume-prompt-title" className="vjs-resume-prompt-title">
                {t.resume.title}
              </h2>
              <p id="resume-prompt-description" className="vjs-resume-prompt-subtitle">
                {t.resume.description}
              </p>
              <p className="vjs-resume-prompt-video-title">
                {videoTitle}
              </p>
            </div>
          </div>

          {/* Saved time display */}
          <div className="vjs-resume-prompt-time">
            <svg
              className="vjs-resume-prompt-time-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="vjs-resume-prompt-time-text">
              {formattedTime}
            </span>
          </div>

          {/* Action buttons */}
          <div className="vjs-resume-prompt-actions">
            <button
              ref={resumeButtonRef}
              onClick={handleResume}
              className="vjs-resume-prompt-button vjs-resume-prompt-button-primary"
              type="button"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {t.resume.resumeButton} {formattedTime}
            </button>
            <button
              onClick={handleStartOver}
              className="vjs-resume-prompt-button vjs-resume-prompt-button-secondary"
              type="button"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {t.resume.startOverButton}
            </button>
          </div>

          {/* Auto-resume countdown */}
          <div className="vjs-resume-prompt-countdown">
            <p className="vjs-resume-prompt-countdown-text">
              {t.resume.autoResumeMessage}{' '}
              <span className="vjs-resume-prompt-countdown-number">{countdown}</span>
              {isRTL ? '...' : '...'}
            </p>
          </div>

          {/* Dismiss hint */}
          <p className="vjs-resume-prompt-hint">
            {t.resume.dismissHint}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ResumePrompt;
