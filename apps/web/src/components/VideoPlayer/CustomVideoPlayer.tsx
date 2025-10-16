/**
 * Custom Video Player Component with Analytics Integration
 *
 * Features:
 * - Video.js player with HLS streaming
 * - Comprehensive error handling (Phase 1.4)
 * - Automatic fallback from HLS to MP4
 * - Retry logic with exponential backoff
 * - Analytics event tracking (Phase 1.5)
 * - Quality selector
 * - Accessibility support
 * - Responsive design
 * - Bilingual error messages
 * - YouTube-style keyboard shortcuts (Phase 2.3)
 * - Volume control with persistence and scroll wheel (Phase 2.5)
 * - Fullscreen and Picture-in-Picture modes (Phase 2.6)
 *
 * Phase 1.4: Error handling with fallback
 * Phase 1.5: Basic analytics (ready, play, pause, ended, error)
 * Phase 2.3: Keyboard shortcuts with visual feedback
 * Phase 2.5: Volume persistence and enhanced controls
 * Phase 2.6: Fullscreen and Picture-in-Picture modes
 * Phase 3: Advanced analytics (seek, quality change, buffering, etc.)
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
import { ErrorDisplay } from './ErrorDisplay';
import { useVideoPlayerI18n } from '@/lib/video/i18n';
import '@/styles/video-player.css';
import type { Player } from 'video.js';
import { hasErrorMethod, type ExtendedPlayer } from '@/lib/video/videojs.d';

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
  const [playerReady, setPlayerReady] = useState(false);
  const [currentError, setCurrentError] = useState<VideoError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

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

        // Phase 2.5: Initialize volume controls
        volumeControlsCleanupRef.current = initializeVolumeControls(player);

        // Phase 2.6: Setup fullscreen and PiP
        setupFullscreenPiP(player as ExtendedPlayer);

        // Phase 2.3: Setup keyboard shortcuts
        keyboardShortcutsCleanupRef.current = setupKeyboardShortcuts(player as ExtendedPlayer, {
          lang,
          showFeedback: true,
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

        // Phase 3: Advanced event tracking (not implemented yet)
        // player.on('seeking', () => { ... });
        // player.on('timeupdate', () => { ... });
        // player.on('qualitychange', () => { ... });
        // player.on('waiting', () => { ... }); // buffer start
        // player.on('canplay', () => { ... }); // buffer end
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

      // Cleanup player
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
    // Note: handleVideoError is NOT in deps - we use handleVideoErrorRef.current to avoid re-initialization
  }, [videoId, userId, sources, poster, controls, autoplay, enableAnalytics]);

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
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={ariaLabel || t.accessibility.videoPlayer}
          tabIndex={0}
        />
      </div>
    </div>
  );
}
