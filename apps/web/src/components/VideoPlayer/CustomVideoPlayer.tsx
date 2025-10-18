/**
 * Custom Video Player Component with Analytics Integration
 *
 * Features:
 * - Video.js player with HLS streaming
 * - Comprehensive error handling (Phase 1.4)
 * - Automatic fallback from HLS to MP4
 * - Retry logic with exponential backoff
 * - Analytics event tracking (Phase 1.5, Phase 3)
 * - Quality selector
 * - Accessibility support
 * - Responsive design
 * - Bilingual error messages
 * - YouTube-style keyboard shortcuts (Phase 2.3)
 * - Volume control with persistence and scroll wheel (Phase 2.5)
 * - Fullscreen and Picture-in-Picture modes (Phase 2.6)
 * - Mobile touch controls and gestures (Phase 4.19)
 *
 * Phase 1.4: Error handling with fallback
 * Phase 1.5: Basic analytics (ready, play, pause, ended, error)
 * Phase 2.3: Keyboard shortcuts with visual feedback
 * Phase 2.5: Volume persistence and enhanced controls
 * Phase 2.6: Fullscreen and Picture-in-Picture modes
 * Phase 3: Advanced analytics - IMPLEMENTED
 *   - Seek tracking (seeking/seeked events)
 *   - Progress tracking (timeupdate, throttled to 10s intervals)
 *   - Quartile milestones (25%, 50%, 75%)
 *   - Buffering metrics (waiting/canplay events)
 *   - Quality change tracking (if quality selector available)
 * Phase 4.19: Mobile touch controls - IMPLEMENTED
 *   - Double-tap left/right for seek (±10s)
 *   - Swipe up/down for volume control
 *   - Long press for playback speed
 *   - Visual feedback animations
 *   - 48x48px minimum touch targets
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import { VideoAnalytics } from '@/services/analytics/video-analytics';
import {
  createVideoErrorHandler,
  VideoErrorHandler,
  VideoError
} from '@/lib/video/error-handler';
import {
  createVideoFallbackStrategy,
  VideoFallbackStrategy,
  VideoSource,
} from '@/lib/video/fallback-strategy';
import {
  setupFullscreenPiP,
  lockOrientationLandscape
} from '@/lib/video/fullscreen-pip';
import { initializeVolumeControls } from '@/lib/video/volume-control';
import { setupKeyboardShortcuts } from '@/lib/video/keyboard-shortcuts';
import { setupMobileTouchControls, isMobileDevice } from '@/lib/video/mobile-touch';
import { setupAccessibility } from '@/lib/video/accessibility';
import { ErrorDisplay } from './ErrorDisplay';
import { BufferingIndicator } from './LoadingStates';
import { useVideoPlayerI18n } from '@/lib/video/i18n';
import '@/styles/video-player.css';
import type { Player } from 'video.js';
import { hasErrorMethod, type ExtendedPlayer } from '@/lib/video/videojs';

export interface CustomVideoPlayerProps {
  videoId: string;
  userId?: string;
  sources: Array<{
    src: string;
    type: string;
  }>;
  poster?: string;
  controls?: boolean;
  autoplay?: boolean;
  enableAnalytics?: boolean;
  className?: string;
  ariaLabel?: string;
  lang?: 'en' | 'ar';
  onError?: (error: VideoError) => void;
  onSourceChange?: (source: VideoSource) => void;
}

/**
 * CustomVideoPlayer with integrated analytics and error handling
 */
export default function CustomVideoPlayer({
  videoId,
  userId,
  sources,
  poster,
  controls = true,
  autoplay = false,
  enableAnalytics = true,
  className = '',
  ariaLabel,
  lang = 'en',
  onError,
  onSourceChange,
}: CustomVideoPlayerProps) {
  const { t, dir } = useVideoPlayerI18n(lang);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const analyticsRef = useRef<VideoAnalytics | null>(null);
  const errorHandlerRef = useRef<VideoErrorHandler | null>(null);
  const fallbackStrategyRef = useRef<VideoFallbackStrategy | null>(null);
  const handleVideoErrorRef = useRef<((error: unknown) => void) | null>(null);
  const volumeControlsCleanupRef = useRef<(() => void) | null>(null);
  const keyboardShortcutsCleanupRef = useRef<(() => void) | null>(null);
  const mobileControlsCleanupRef = useRef<(() => void) | null>(null);
  const accessibilityCleanupRef = useRef<(() => void) | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentError, setCurrentError] = useState<VideoError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferProgress, setBufferProgress] = useState<number>(0);

  // Phase 3: Advanced analytics state tracking
  const seekStartTimeRef = useRef<number>(0);
  const lastProgressTrackRef = useRef<number>(0);
  const quartilesFiredRef = useRef<Set<25 | 50 | 75>>(new Set());

  /**
   * Handle source changes (for fallback)
   */
  const handleSourceChange = useCallback((newSource: VideoSource) => {
    if (!playerRef.current) return;

    try {
      playerRef.current.src([{
        src: newSource.url,
        type: newSource.type === 'hls' ? 'application/x-mpegURL' : 'video/mp4',
      }]);

      if (onSourceChange) {
        onSourceChange(newSource);
      }

      setCurrentError(null);
    } catch (err) {
      console.error('[CustomVideoPlayer] Source change error:', err);
    }
  }, [onSourceChange]);

  /**
   * Handle video errors with retry and fallback logic
   *
   * Note: This callback is stored in a ref to prevent useEffect from
   * re-running when the onError prop changes, avoiding race conditions
   * and unnecessary player reinitialization.
   */
  const handleVideoError = useCallback((error: unknown) => {
    if (!errorHandlerRef.current || !fallbackStrategyRef.current) return;

    const categorizedError = errorHandlerRef.current.categorizeError(
      error,
      videoRef.current || undefined
    );

    setCurrentError(categorizedError);
    console.error('[CustomVideoPlayer] Error:', categorizedError);

    // Track error in analytics
    analyticsRef.current?.trackError({
      code: categorizedError.code || 'UNKNOWN',
      message: categorizedError.message,
      type: categorizedError.type
    });

    // Call optional error callback
    if (onError) {
      onError(categorizedError);
    }

    // Try automatic fallback if available
    if (categorizedError.fallbackAvailable) {
      const fallbackSource = fallbackStrategyRef.current.getNextFallback(categorizedError);
      if (fallbackSource) {
        handleSourceChange(fallbackSource);
      }
    }
  }, [onError, handleSourceChange]);

  // Store handleVideoError in ref to avoid useEffect re-runs
  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  /**
   * Handle retry button click
   */
  const handleRetry = useCallback(async () => {
    if (!fallbackStrategyRef.current || !playerRef.current) return;

    setIsRetrying(true);
    setCurrentError(null);

    try {
      fallbackStrategyRef.current.reset();
      errorHandlerRef.current?.resetRetryCount();

      const source = fallbackStrategyRef.current.getCurrentSource();
      if (source) {
        handleSourceChange(source);
      }
    } catch (err) {
      handleVideoError(err);
    } finally {
      setIsRetrying(false);
    }
  }, [handleSourceChange, handleVideoError]);

  /**
   * Handle fallback button click
   */
  const handleFallback = useCallback(() => {
    if (!currentError || !fallbackStrategyRef.current) return;

    const fallbackSource = fallbackStrategyRef.current.getNextFallback(currentError);
    if (fallbackSource) {
      handleSourceChange(fallbackSource);
    }
  }, [currentError, handleSourceChange]);

  useEffect(() => {
    if (!videoRef.current) return;

    // Prevent double initialization in React Strict Mode
    if (playerRef.current) return;

    try {
      // Initialize error handler (Phase 1.4)
      errorHandlerRef.current = createVideoErrorHandler();

      // Initialize fallback strategy (Phase 1.4)
      fallbackStrategyRef.current = createVideoFallbackStrategy();

      // Note: Fallback strategy initialization with sources will be done
      // when we have access to MP4 URLs from BunnyStreamService

      // Add error reporter for analytics
      if (enableAnalytics) {
        errorHandlerRef.current.addErrorReporter(() => {
          // Error reported to analytics
        });
      }

      // Initialize analytics (Phase 1.5)
      if (enableAnalytics) {
        analyticsRef.current = new VideoAnalytics(videoId, userId);
      }

      // Initialize Video.js player
      playerRef.current = createVideoPlayer(videoRef.current, {
        controls,
        autoplay,
        sources,
        poster
      });

      const player = playerRef.current;

      if (!player) {
        throw new Error('Failed to initialize video player');
      }

      // Setup event handlers
      player.ready(() => {
        setPlayerReady(true);
        analyticsRef.current?.trackReady();

        // Reset quartiles when video loads
        quartilesFiredRef.current.clear();

        // Phase 2.5: Initialize volume controls
        volumeControlsCleanupRef.current = initializeVolumeControls(player);

        // Phase 2.6: Setup fullscreen and PiP
        setupFullscreenPiP(player as ExtendedPlayer);

        // Phase 2.3: Setup keyboard shortcuts
        keyboardShortcutsCleanupRef.current = setupKeyboardShortcuts(player as ExtendedPlayer, {
          lang,
          showFeedback: true,
        });

        // Phase 4.19: Setup mobile touch controls on mobile devices
        if (isMobileDevice()) {
          mobileControlsCleanupRef.current = setupMobileTouchControls(player as ExtendedPlayer, {
            enableDoubleTap: true,
            enableSwipeVolume: true,
            enableLongPress: true,
          });
        }

        // Phase 4.21: Setup accessibility enhancements
        accessibilityCleanupRef.current = setupAccessibility(player as ExtendedPlayer, {
          lang,
          announcements: true,
        });

        // Phase 2.6: Track fullscreen changes
        player.on('fullscreenchange', () => {
          const extPlayer = player as ExtendedPlayer;
          const isFullscreen = extPlayer.isFullscreen();
          analyticsRef.current?.trackFullscreenChange(isFullscreen);
          lockOrientationLandscape(isFullscreen).catch((err) => {
            console.error('[CustomVideoPlayer] Orientation lock failed:', err);
          });
        });

        // Phase 2.6: Track PiP changes
        player.on('enterpictureinpicture', () => {
          analyticsRef.current?.trackPictureInPicture(true);
        });

        player.on('leavepictureinpicture', () => {
          analyticsRef.current?.trackPictureInPicture(false);
        });

        // Phase 1.5: Basic event tracking
        player.on('play', () => {
          analyticsRef.current?.trackPlay();
          setCurrentError(null); // Clear error on successful play
        });

        player.on('pause', () => {
          analyticsRef.current?.trackPause();
        });

        player.on('ended', () => {
          analyticsRef.current?.trackComplete();
        });

        player.on('error', () => {
          // Get error from player using type guard for safety
          if (hasErrorMethod(player)) {
            const playerError = player.error();
            if (playerError && handleVideoErrorRef.current) {
              handleVideoErrorRef.current(playerError);
            }
          }
        });

        // ==================== Phase 3: Advanced Analytics ====================

        // Seeking events - track when user seeks to different position
        player.on('seeking', () => {
          // Store the current time when seek starts
          seekStartTimeRef.current = player.currentTime();
        });

        player.on('seeked', () => {
          // Track the seek event with from/to times
          const fromTime = seekStartTimeRef.current;
          const toTime = player.currentTime();
          analyticsRef.current?.trackSeek(fromTime, toTime);
        });

        // Progress tracking - throttled to once per 10 seconds
        // Also handles quartile tracking (25%, 50%, 75%)
        player.on('timeupdate', () => {
          const currentTime = player.currentTime();
          const duration = player.duration();

          // Skip if duration not available yet
          if (!duration || isNaN(duration) || duration === 0) {
            return;
          }

          const now = Date.now();
          const percentage = (currentTime / duration) * 100;

          // Throttle progress tracking to once per 10 seconds
          // This prevents spamming analytics with ~4 events per second
          const PROGRESS_INTERVAL = 10000; // 10 seconds
          if (now - lastProgressTrackRef.current >= PROGRESS_INTERVAL) {
            analyticsRef.current?.trackProgress(currentTime, duration, percentage);
            lastProgressTrackRef.current = now;
          }

          // Track quartiles - only fire once per quartile per session
          // Use loop to check quartiles instead of nested if-else for better maintainability
          const quartiles: Array<25 | 50 | 75> = [25, 50, 75];
          for (let i = 0; i < quartiles.length; i++) {
            const q = quartiles[i];
            const lower = q;
            const upper = i < quartiles.length - 1 ? quartiles[i + 1] : 100;
            if (percentage >= lower && percentage < upper && !quartilesFiredRef.current.has(q)) {
              analyticsRef.current?.trackQuartile(q);
              quartilesFiredRef.current.add(q);
              break; // Only track one quartile per timeupdate
            }
          }
        });

        // Phase 4.20: Buffering events - track buffer start and end times
        player.on('waiting', () => {
          // Video is buffering (waiting for data)
          setIsBuffering(true);
          analyticsRef.current?.trackBufferStart();
        });

        player.on('canplay', () => {
          // Video can resume playback after buffering
          setIsBuffering(false);
          // trackBufferEnd() automatically calculates duration since trackBufferStart()
          analyticsRef.current?.trackBufferEnd();
        });

        player.on('playing', () => {
          // Video is playing - clear buffering state
          setIsBuffering(false);
        });

        // Phase 4.20: Track buffer progress (throttled to 500ms)
        let lastBufferUpdate = 0;
        const BUFFER_UPDATE_INTERVAL = 500; // 500ms

        player.on('progress', () => {
          const now = Date.now();
          if (now - lastBufferUpdate < BUFFER_UPDATE_INTERVAL) {
            return;
          }
          lastBufferUpdate = now;

          const extPlayer = player as ExtendedPlayer;
          // Use proper type-safe buffered() method
          if (typeof extPlayer.buffered === 'function') {
            const buffered = extPlayer.buffered();
            const duration = extPlayer.duration ? extPlayer.duration() : 0;

            if (buffered.length > 0 && duration > 0) {
              // Calculate percentage of video buffered
              const bufferedEnd = buffered.end(buffered.length - 1);
              const percentage = (bufferedEnd / duration) * 100;
              setBufferProgress(Math.min(100, percentage));
            }
          }
        });

        // Quality change tracking (if quality selector is available)
        // Note: This requires Video.js quality selector plugin
        // The event name might vary depending on the quality plugin used
        // Common event names: 'qualitychange', 'qualitySelected', 'resolutionchange'

        // Try to access quality levels API if available
        const extPlayer = player as ExtendedPlayer;
        if (typeof extPlayer.qualityLevels === 'function') {
          try {
            const qualityLevels = extPlayer.qualityLevels();
            let previousQuality = 'auto'; // Default to auto

            qualityLevels.on('change', () => {
              // Find the currently selected quality level
              const selectedIndex = qualityLevels.selectedIndex;
              if (selectedIndex >= 0 && selectedIndex < qualityLevels.length) {
                const currentLevel = qualityLevels[selectedIndex];
                const currentQuality = currentLevel.height ? `${currentLevel.height}p` : 'auto';

                // Track the quality change
                analyticsRef.current?.trackQualityChange(previousQuality, currentQuality);

                // Update previous quality for next change
                previousQuality = currentQuality;
              }
            });
          } catch (err) {
            // Quality levels API not available, skip quality tracking
            if (process.env.NODE_ENV === 'development') {
              console.log('[CustomVideoPlayer] Quality levels API not available:', err);
            }
          }
        }
      });
    } catch (err) {
      if (handleVideoErrorRef.current) {
        handleVideoErrorRef.current(err);
      }
    }

    // Cleanup on unmount
    return () => {
      // Cleanup analytics
      analyticsRef.current?.destroy();
      analyticsRef.current = null;

      // Cleanup error handler
      errorHandlerRef.current = null;
      fallbackStrategyRef.current = null;

      // Cleanup volume controls
      if (volumeControlsCleanupRef.current) {
        volumeControlsCleanupRef.current();
        volumeControlsCleanupRef.current = null;
      }

      // Cleanup keyboard shortcuts
      if (keyboardShortcutsCleanupRef.current) {
        keyboardShortcutsCleanupRef.current();
        keyboardShortcutsCleanupRef.current = null;
      }

      // Cleanup mobile touch controls
      if (mobileControlsCleanupRef.current) {
        mobileControlsCleanupRef.current();
        mobileControlsCleanupRef.current = null;
      }

      // Cleanup accessibility
      if (accessibilityCleanupRef.current) {
        accessibilityCleanupRef.current();
        accessibilityCleanupRef.current = null;
      }

      // Cleanup player
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
    // Note: handleVideoError is NOT in deps - we use handleVideoErrorRef.current to avoid re-initialization
    // lang is included because it's used in setupKeyboardShortcuts() and changes should re-initialize the player
  }, [videoId, userId, sources, poster, controls, autoplay, enableAnalytics, lang]);

  /**
   * Render error display if there's an error
   */
  if (currentError) {
    return (
      <div className={`custom-video-player ${className}`}>
        <ErrorDisplay
          error={currentError}
          lang={lang}
          onRetry={currentError.retryable && !isRetrying ? handleRetry : undefined}
          onFallback={currentError.fallbackAvailable && !isRetrying ? handleFallback : undefined}
          showDetails={process.env.NODE_ENV === 'development'}
          className="aspect-video"
        />
      </div>
    );
  }

  return (
    <div className={`custom-video-player ${className}`} dir={dir}>
      {/* Accessibility: Hidden live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {playerReady ? t.player.ready : t.player.loading}
      </div>

      {/* Video player container */}
      <div data-vjs-player className="relative">
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={ariaLabel || t.accessibility.videoPlayer}
          tabIndex={0}
        />

        {/* Phase 4.20: Buffering indicator */}
        {isBuffering && playerReady && (
          <BufferingIndicator progress={bufferProgress} lang={lang} />
        )}
      </div>
    </div>
  );
}
