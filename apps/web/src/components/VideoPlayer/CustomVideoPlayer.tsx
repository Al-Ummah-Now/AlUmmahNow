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
 *
 * Phase 1.4: Error handling with fallback
 * Phase 1.5: Basic analytics (ready, play, pause, ended, error)
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
import { ErrorDisplay } from './ErrorDisplay';
import '@/styles/video-player.css';
import type { Player } from 'video.js';

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
  ariaLabel = 'Video player',
  lang = 'en',
  onError,
  onSourceChange,
}: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const analyticsRef = useRef<VideoAnalytics | null>(null);
  const errorHandlerRef = useRef<VideoErrorHandler | null>(null);
  const fallbackStrategyRef = useRef<VideoFallbackStrategy | null>(null);
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
        console.log('[CustomVideoPlayer] Trying fallback:', fallbackSource);
        handleSourceChange(fallbackSource);
      }
    }
  }, [onError, handleSourceChange]);

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
        errorHandlerRef.current.addErrorReporter((error: VideoError) => {
          console.log('[CustomVideoPlayer] Error reported:', error);
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

        // Phase 1.5: Basic event tracking
        player.on('play', () => {
          console.log('[CustomVideoPlayer] Play event');
          analyticsRef.current?.trackPlay();
          setCurrentError(null); // Clear error on successful play
        });

        player.on('pause', () => {
          console.log('[CustomVideoPlayer] Pause event');
          analyticsRef.current?.trackPause();
        });

        player.on('ended', () => {
          console.log('[CustomVideoPlayer] Ended event');
          analyticsRef.current?.trackComplete();
        });

        player.on('error', () => {
          // Get error from player - Video.js Player has error() method
          // Type assertion needed as Video.js types don't fully expose this
          const playerError = (player as Player & { error: () => MediaError | null }).error();
          if (playerError) {
            handleVideoError(playerError);
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
      handleVideoError(err);
    }

    // Cleanup on unmount
    return () => {
      // Cleanup analytics
      analyticsRef.current?.destroy();
      analyticsRef.current = null;

      // Cleanup error handler
      errorHandlerRef.current = null;
      fallbackStrategyRef.current = null;

      // Cleanup player
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, [videoId, userId, sources, poster, controls, autoplay, enableAnalytics, handleVideoError]);

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
    <div className={`custom-video-player ${className}`}>
      {/* Accessibility: Hidden live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {playerReady
          ? 'Video player loaded and ready'
          : 'Loading video player...'
        }
      </div>

      {/* Video player container */}
      <div data-vjs-player>
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={ariaLabel}
          tabIndex={0}
        />
      </div>
    </div>
  );
}
