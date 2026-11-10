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
 * Issue #57: Watch progress tracking - IMPLEMENTED
 *   - Save watch progress every 10 seconds (throttled)
 *   - Save on pause, seek, and video end
 *   - localStorage fallback for unauthenticated users
 *   - Load saved progress on player mount for resume functionality
 * #242: Resume - the player opens already at the saved position, with a
 *   persistent "Start from beginning" pill; no prompt or countdown
 */

'use client';
import { logger } from '@/lib/logger-client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { createVideoPlayer, disposeVideoPlayer } from '@/lib/video/videojs-setup';
import { isSameMediaUrl } from '@/lib/video/media-url';
import { isLivePlayback } from '@/lib/video/live-state';
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
import { showGestureHintOnce } from '@/lib/video/gesture-hint';
import { setupAccessibility } from '@/lib/video/accessibility';
import { createPerformanceMonitor } from '@/lib/video/performance-monitor';
import { ErrorDisplay } from './ErrorDisplay';
import { SettingsMenu } from './SettingsMenu';
import { ProgressTooltip } from './ProgressTooltip';
import { EndScreen, MiniPlayerButtons } from './PlayerOverlays';
import { getPlayerUi, subscribePlayerUi } from '@/lib/video/player-ui';
import { keepFrameInView } from '@/lib/video/theatre-scroll';
import { applyBuiltInIcons } from '@/lib/video/components';
import { ViewerCount } from './ViewerCount';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import { setupTouchFeedback } from '@/lib/touch/touch-feedback';
import { useVideoPlayerI18n } from '@/lib/video/i18n';
import { useVideoWebSocket } from '@/hooks/useVideoWebSocket';
import { useWatchProgress } from '@/hooks/useWatchProgress';
import { formatResumeTime, resumePosition, startOverStillRelevant } from '@/lib/video/resume';
import '@/theme/player-themes.css';
import '@/styles/video-player.css';
import '@/styles/player-skin.css';
import '@/styles/keyboard-feedback.css';
import type { Player } from 'video.js';
import { hasErrorMethod, type ExtendedPlayer } from '@/lib/video/videojs';
import type { PlayerTextTrack } from '@/lib/video/subtitle-tracks';
import type { AnalyticsContext } from '@al-ummah/shared-types';

// Layout effects only run in the browser; React 18 warns when the server render meets one
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface CustomVideoPlayerProps {
  videoId: string;
  userId?: string;
  authToken?: string;
  sources: Array<{
    src: string;
    type: string;
  }>;
  poster?: string;
  controls?: boolean;
  autoplay?: boolean;
  enableAnalytics?: boolean;
  enableWebSocket?: boolean;
  isLive?: boolean;
  /** Short by the shared rule: always starts from the beginning (no resume) */
  isShort?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Video title (kept for callers; the resume prompt that showed it is gone, #242) */
  title?: string;
  lang?: 'en' | 'ar';
  onError?: (error: VideoError) => void;
  onSourceChange?: (source: VideoSource) => void;
  /** Subtitle/caption tracks (WebVTT URLs) to attach to the player */
  textTracks?: PlayerTextTrack[];
  /** Called once the Video.js player is ready (e.g. for chapter integration) */
  onPlayerReady?: (player: Player) => void;
  /** Start position in seconds (watch page ?t=, embed start=) */
  startTime?: number;
  /** Start muted, overriding the remembered volume (embed autoplay must be muted) */
  muted?: boolean;
  /** Playback surface sent with analytics batches (embeds tag source/origin) */
  analyticsContext?: AnalyticsContext;
}

/**
 * CustomVideoPlayer with integrated analytics and error handling
 */
export default function CustomVideoPlayer({
  videoId,
  userId,
  authToken,
  sources,
  poster,
  controls = true,
  autoplay = false,
  enableAnalytics = true,
  enableWebSocket = true,
  isLive = false,
  isShort = false,
  className = '',
  ariaLabel,
  lang = 'en',
  onError,
  onSourceChange,
  textTracks,
  onPlayerReady,
  startTime,
  muted,
  analyticsContext,
}: CustomVideoPlayerProps) {
  const { t, dir } = useVideoPlayerI18n(lang);
  const playerRef = useRef<Player | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const analyticsRef = useRef<VideoAnalytics | null>(null);
  const errorHandlerRef = useRef<VideoErrorHandler | null>(null);
  const fallbackStrategyRef = useRef<VideoFallbackStrategy | null>(null);
  const performanceMonitorRef = useRef<ReturnType<typeof createPerformanceMonitor> | null>(null);
  const handleVideoErrorRef = useRef<((error: unknown) => void) | null>(null);
  const volumeControlsCleanupRef = useRef<(() => void) | null>(null);
  const keyboardShortcutsCleanupRef = useRef<(() => void) | null>(null);
  const mobileControlsCleanupRef = useRef<(() => void) | null>(null);
  const accessibilityCleanupRef = useRef<(() => void) | null>(null);
  const qualityLevelsCleanupRef = useRef<(() => void) | null>(null);
  const isInitializingRef = useRef(false);
  const onPlayerReadyRef = useRef(onPlayerReady);
  const addedTextTracksRef = useRef<Array<{ track: unknown }>>([]);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentError, setCurrentError] = useState<VideoError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [mini, setMini] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const miniDismissedRef = useRef(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const playerUi = useSyncExternalStore(subscribePlayerUi, getPlayerUi, getPlayerUi);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isKeyboardHelpOpen, setIsKeyboardHelpOpen] = useState(false);
  const touchFeedbackCleanupRef = useRef<(() => void) | null>(null);

  // Phase 3: Advanced analytics state tracking
  const seekStartTimeRef = useRef<number>(0);
  const lastProgressTrackRef = useRef<number>(0);
  const quartilesFiredRef = useRef<Set<25 | 50 | 75>>(new Set());

  // WebSocket integration for real-time metrics
  // Memoize onError to prevent re-creating on every render
  const handleWebSocketError = useCallback((error: Error) => {
    logger.error('[CustomVideoPlayer] WebSocket error:', error);
  }, []);

  const { viewerCount, isConnected: wsConnected } = useVideoWebSocket({
    videoId,
    userId,
    autoConnect: enableWebSocket,
    isPlaying,
    onError: handleWebSocketError
  });

  // Issue #57: Watch progress tracking integration
  // Automatically saves watch progress every 10 seconds and on pause/seek/end events
  // Falls back to localStorage for unauthenticated users
  const { savedProgress, loadedProgress } = useWatchProgress(
    videoId,
    // Keyed on playerReady (state) so the hook receives the player on the
    // re-render after video.js 'ready' rather than a ref read at first render.
    (playerReady ? playerRef.current : null) as ExtendedPlayer | null,
    userId,
    authToken,
    {
      enableDebugLogging: process.env.NODE_ENV === 'development',
    }
  );

  // #242: open at the position stored before this watch (API for signed-in
  // users, device storage otherwise). Decided once per video, so the saves of
  // the current watch never move the player. A `t=`/start= position wins, and
  // a viewer who already pressed play is never moved.
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [showStartOver, setShowStartOver] = useState(false);
  const [resumeAnnouncement, setResumeAnnouncement] = useState('');
  const resumeDecidedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!playerReady || !loadedProgress || loadedProgress.videoId !== videoId) return;
    if (resumeDecidedForRef.current === videoId) return;
    resumeDecidedForRef.current = videoId;
    const player = playerRef.current as ExtendedPlayer | null;
    if (!player || (startTime && startTime > 0)) return;
    const position = resumePosition(loadedProgress, isLive, isShort);
    if (position === null) return;

    const seekToResume = () => {
      try {
        // Pressed play (or sought) before the saved position arrived: leave it
        if (player.hasStarted() || (player.currentTime() ?? 0) >= 1) return;
        const duration = player.duration();
        if (duration && Number.isFinite(duration) && position >= duration) return;
        player.currentTime(position);
      } catch {
        return; // player disposed
      }
      setResumeAt(position);
      setShowStartOver(true);
      setResumeAnnouncement(t.resume.resumingAt.replace('{time}', formatResumeTime(position)));
    };
    // Through MSE (VHS), once the first frame is buffered: WebKitGTK's MSE (GStreamer) fails a
    // seek made while nothing is buffered yet ("Failed to push buffer", a code 4 media error), and
    // that error replaced the player with the error screen. Native HLS (Safari, iOS) stays on
    // metadata: iOS buffers no frame before the first play, so loadeddata would come too late
    let viaMse = false;
    try {
      viaMse = !!(player as unknown as { tech?: (opts: object) => { vhs?: unknown } | undefined })
        .tech?.({ IWillNotUseThisInPlugins: true })?.vhs;
    } catch {
      viaMse = false;
    }
    const needed = viaMse ? 2 : 1;
    if ((player.readyState?.() ?? 0) >= needed) seekToResume();
    else player.one(viaMse ? 'loadeddata' : 'loadedmetadata', seekToResume);
  }, [playerReady, loadedProgress, videoId, isLive, isShort, startTime, t]);

  // The pill goes once playback is well past the resume point or back at 0
  useEffect(() => {
    const player = playerRef.current;
    if (!showStartOver || resumeAt === null || !player) return undefined;
    const onTimeUpdate = () => {
      let time: number;
      try {
        time = player.currentTime() ?? 0;
      } catch {
        return;
      }
      if (!startOverStillRelevant(resumeAt, time)) setShowStartOver(false);
    };
    player.on('timeupdate', onTimeUpdate);
    return () => {
      player.off('timeupdate', onTimeUpdate);
    };
  }, [showStartOver, resumeAt]);

  const handleStartOver = useCallback(() => {
    const player = playerRef.current;
    setShowStartOver(false);
    if (!player) return;
    player.currentTime(0);
    // The pill had focus; keep keyboard users on the player
    (player.el() as HTMLElement | null)?.focus?.();
  }, []);

  // Log saved progress for debugging
  useEffect(() => {
    if (savedProgress && process.env.NODE_ENV === 'development') {
      logger.debug('[CustomVideoPlayer] Saved watch progress:', savedProgress);
    }
  }, [savedProgress]);

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
      logger.error('[CustomVideoPlayer] Source change error:', err);
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
      videoElementRef.current || undefined
    );

    setCurrentError(categorizedError);
    logger.error('[CustomVideoPlayer] Error:', categorizedError);
    logger.error('[CustomVideoPlayer] Error Details (JSON):', JSON.stringify(categorizedError, null, 2));

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
      } else {
        // Nothing left to fall back to: don't offer a "try another format"
        // button that would do nothing
        setCurrentError({ ...categorizedError, fallbackAvailable: false });
      }
    }
  }, [onError, handleSourceChange]);

  // Store handleVideoError in ref to avoid useEffect re-runs
  useEffect(() => {
    handleVideoErrorRef.current = handleVideoError;
  }, [handleVideoError]);

  // Keep latest onPlayerReady without re-initializing the player
  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
  }, [onPlayerReady]);

  /**
   * Attach subtitle tracks. Previously added remote tracks are removed first so
   * switching videos (or reloading the track list) never duplicates tracks. The
   * tracks follow this list, not the source, so a source reset keeps them.
   */
  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player || typeof player.addRemoteTextTrack !== 'function') return;

    for (const added of addedTextTracksRef.current) {
      try {
        player.removeRemoteTextTrack?.(added.track);
      } catch (err) {
        logger.debug('[CustomVideoPlayer] Failed to remove text track', err);
      }
    }
    addedTextTracksRef.current = [];

    for (const track of textTracks || []) {
      try {
        const element = player.addRemoteTextTrack(
          {
            kind: track.kind,
            src: track.src,
            srclang: track.srclang,
            label: track.label,
            default: track.default,
            mode: track.default ? 'showing' : 'disabled',
          },
          // This effect removes them itself; left to Video.js they would be dropped whenever the
          // source is set again (Safari's HLS path sets it twice), losing captions there
          true
        );
        if (element) addedTextTracksRef.current.push(element);
      } catch (err) {
        logger.error('[CustomVideoPlayer] Failed to add text track', { srclang: track.srclang, err });
      }
    }

    if ((textTracks || []).length > 0) {
      logger.debug('[CustomVideoPlayer] Attached subtitle tracks', {
        videoId,
        languages: (textTracks || []).map((t) => t.srclang),
      });
    }
  }, [playerReady, textTracks, videoId]);

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

  /**
   * Ref callback for video element - called when element is mounted to DOM
   * This is the proper React pattern for integrating with third-party DOM libraries
   * See: https://react.dev/learn/manipulating-the-dom-with-refs#how-to-manage-a-list-of-refs-using-a-ref-callback
   */
  const videoRefCallback = useCallback((videoElement: HTMLVideoElement | null) => {
    // Store the element reference
    videoElementRef.current = videoElement;

    // If element is being removed (null), just store the ref
    // DON'T dispose the player here - let the cleanup useEffect handle it
    // This prevents issues with React Strict Mode's double-mount cycle
    if (!videoElement) {
      logger.debug('[CustomVideoPlayer] Ref callback called with null (likely Strict Mode), skipping disposal');
      return;
    }

    // Prevent double initialization
    if (playerRef.current || isInitializingRef.current) {
      logger.debug('[CustomVideoPlayer] Player already initialized or initializing, skipping');
      return;
    }

    isInitializingRef.current = true;
    logger.debug('[CustomVideoPlayer] Initializing player...');

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
        analyticsRef.current = (analyticsContext
          ? new VideoAnalytics(videoId, userId, { context: analyticsContext })
          : new VideoAnalytics(videoId, userId));
      }

      // Initialize Video.js player with the DOM element
      playerRef.current = createVideoPlayer(videoElement, {
        controls,
        autoplay,
        sources,
        poster,
        language: lang,
      });

      const player = playerRef.current;

      if (!player) {
        throw new Error('Failed to initialize video player');
      }

      // Setup event handlers
      player.ready(() => {
        isInitializingRef.current = false;
        setPlayerReady(true);
        analyticsRef.current?.trackReady();
        onPlayerReadyRef.current?.(player);

        // Reset quartiles when video loads
        quartilesFiredRef.current.clear();

        // Phase 2.5: Initialize volume controls
        volumeControlsCleanupRef.current = initializeVolumeControls(player, lang);
        // Muted start wins over the remembered volume (browsers only autoplay muted)
        if (muted) (player as ExtendedPlayer).muted(true);

        // Start position: applied once the duration is known (seeking earlier is ignored)
        if (startTime && startTime > 0) {
          const seekToStart = () => {
            const duration = player.duration();
            if (!duration || !Number.isFinite(duration) || startTime < duration) {
              player.currentTime(startTime);
            }
          };
          if ((player as ExtendedPlayer).readyState?.() >= 1) seekToStart();
          else player.one('loadedmetadata', seekToStart);
        }

        // Phase 2.6: Setup fullscreen and PiP
        setupFullscreenPiP(player as ExtendedPlayer);
        applyBuiltInIcons(player.el());

        // Shorts: a portrait video gets a portrait frame. Safari's native HLS can report no
        // dimensions at loadedmetadata and fills them in later with the media resize event.
        const extendedForAspect = player as ExtendedPlayer;
        const updateAspect = () => setPortrait(extendedForAspect.videoHeight() > extendedForAspect.videoWidth());
        player.on('loadedmetadata', updateAspect);
        player.on('resize', updateAspect);
        if (extendedForAspect.readyState() >= 1) updateAspect();

        // Phase 2.3: Setup keyboard shortcuts
        keyboardShortcutsCleanupRef.current = setupKeyboardShortcuts(player as ExtendedPlayer, {
          lang,
          showFeedback: true,
          // Story 1.4 AC 3: "?" key and a control-bar button open the shortcut list
          onShowHelp: () => setIsKeyboardHelpOpen(true),
        });

        // Story 1.5 AC 3: visual (and, where supported, haptic) touch feedback
        touchFeedbackCleanupRef.current = setupTouchFeedback(player.el() as HTMLElement);

        // Phase 4.19: Setup mobile touch controls on mobile devices
        if (isMobileDevice()) {
          mobileControlsCleanupRef.current = setupMobileTouchControls(player as ExtendedPlayer, {
            enableDoubleTap: true,
            enableSwipeVolume: true,
            enableLongPress: true,
          });
          showGestureHintOnce(player.el() as HTMLElement, lang);
        }

        // Phase 4.21: Setup accessibility enhancements
        accessibilityCleanupRef.current = setupAccessibility(player as ExtendedPlayer, {
          lang,
          announcements: true,
        });

        // Phase 4.2: Initialize performance monitoring
        performanceMonitorRef.current = createPerformanceMonitor(player as ExtendedPlayer);

        // Phase 2.6: Track fullscreen changes
        player.on('fullscreenchange', () => {
          const extPlayer = player as ExtendedPlayer;
          const isFullscreen = extPlayer.isFullscreen();
          analyticsRef.current?.trackFullscreenChange(isFullscreen);
          lockOrientationLandscape(isFullscreen).catch((err) => {
            logger.error('[CustomVideoPlayer] Orientation lock failed:', err);
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
          setEnded(false);
          analyticsRef.current?.trackPlay();
          setCurrentError(null); // Clear error on successful play
          setIsPlaying(true);
        });

        player.on('pause', () => {
          analyticsRef.current?.trackPause();
          setIsPlaying(false);
        });

        player.on('seeking', () => setEnded(false));
        player.on('loadstart', () => setEnded(false));
        player.on('ended', () => {
          // A live stream can report ended while it waits for the next segment (WebKit on Linux
          // does); it has no up next until its playlist ends, which makes the duration finite
          const live = isLivePlayback(player as unknown as Parameters<typeof isLivePlayback>[0]);
          if (!live && !(player as ExtendedPlayer).loop()) setEnded(true);
          analyticsRef.current?.trackComplete();
          setIsPlaying(false);
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

        // Video.js reports an unsupported source ("No compatible source", code 4)
        // before `ready`, so the listener above never sees it. Surface an error
        // that is already set so the localized ErrorDisplay replaces the player.
        if (hasErrorMethod(player)) {
          const earlyError = player.error();
          if (earlyError && handleVideoErrorRef.current) {
            logger.warn('[CustomVideoPlayer] Player errored before ready', { code: earlyError.code });
            handleVideoErrorRef.current(earlyError);
          }
        }

        // ==================== Phase 3: Advanced Analytics ====================

        // Loading milestones. Metadata may already be known by the time the player is ready.
        const extended = player as ExtendedPlayer;
        const reportMetadata = () => {
          analyticsRef.current?.trackMetadataLoaded(player.duration() ?? 0, extended.videoWidth(), extended.videoHeight());
        };
        player.on('loadstart', () => analyticsRef.current?.trackLoadStart());
        if (extended.readyState() >= 1) reportMetadata();
        else player.one('loadedmetadata', reportMetadata);

        // Only real changes: restoring the saved volume above also fires volumechange
        let lastVolume = player.volume() ?? 1;
        let lastMuted = player.muted() ?? false;
        player.on('volumechange', () => {
          const volume = player.volume() ?? lastVolume;
          const isMuted = player.muted() ?? lastMuted;
          if (volume === lastVolume && isMuted === lastMuted) return;
          lastVolume = volume;
          lastMuted = isMuted;
          analyticsRef.current?.trackVolumeChange(volume, isMuted);
        });

        let lastRate = extended.playbackRate();
        player.on('ratechange', () => {
          const rate = extended.playbackRate();
          if (rate === lastRate) return;
          analyticsRef.current?.trackSpeedChange(rate, lastRate);
          lastRate = rate;
        });

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

          // #235: real watch time (seeks/pauses break the run inside)
          if (!player.paused()) analyticsRef.current?.trackPlayback(currentTime);

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
        // Phase 4.20: buffering metrics. The themed Video.js spinner shows the state.
        player.on('waiting', () => {
          analyticsRef.current?.trackBufferStart();
        });

        player.on('canplay', () => {
          // trackBufferEnd() automatically calculates duration since trackBufferStart()
          analyticsRef.current?.trackBufferEnd();
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

            const qualityChangeHandler = () => {
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
            };

            qualityLevels.on('change', qualityChangeHandler);

            // Store cleanup function
            qualityLevelsCleanupRef.current = () => {
              qualityLevels.off('change', qualityChangeHandler);
            };
          } catch (err) {
            // Quality levels API not available, skip quality tracking
            if (process.env.NODE_ENV === 'development') {
              logger.debug('[CustomVideoPlayer] Quality levels API not available:', err);
            }
          }
        }
      });
    } catch (err) {
      isInitializingRef.current = false;
      if (handleVideoErrorRef.current) {
        handleVideoErrorRef.current(err);
      }
    }
    // CRITICAL: No dependencies! Ref callback should only run when element mounts/unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Effect to handle videoId changes - update player source when video changes
   * This allows navigation between videos without full player reinitialization
   */
  useEffect(() => {
    if (!playerRef.current || !videoId) return;

    const player = playerRef.current as ExtendedPlayer;
    // The source Video.js was given (the element reports a blob or an absolute URL instead)
    const currentSrc = (player as ExtendedPlayer & { currentSource?: () => { src?: string } | undefined }).currentSource?.()?.src || player.currentSrc();
    const newSrc = sources[0]?.src;

    // Only update if the source actually changed
    if (currentSrc && newSrc && !isSameMediaUrl(currentSrc, newSrc)) {
      logger.debug(`[CustomVideoPlayer] Video ID changed, updating source to ${videoId}`);

      // Reset quartiles for new video
      quartilesFiredRef.current.clear();
      lastProgressTrackRef.current = 0;

      // Update player source
      player.src(sources);

      if (poster) {
        player.poster(poster);
      }

      // Reset analytics for new video
      if (analyticsRef.current) {
        analyticsRef.current.destroy();
        if (enableAnalytics) {
          analyticsRef.current = (analyticsContext
          ? new VideoAnalytics(videoId, userId, { context: analyticsContext })
          : new VideoAnalytics(videoId, userId));
        }
      }

      // Load the new video
      player.load();
    }
  // analyticsContext is fixed for the life of an embed frame
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, sources, poster, enableAnalytics, userId]);

  /**
   * Cleanup effect - runs when component unmounts
   *
   * React Strict Mode Note:
   * This cleanup runs during Strict Mode's simulated unmount, but we guard against
   * disposing the player if it was never initialized (playerRef.current is null).
   * This prevents the "element not in DOM" error during the double-mount cycle.
   */
  useEffect(() => {
    return () => {
      // React Strict Mode Guard:
      // During Strict Mode's simulated unmount, the ref callback is called with null,
      // which sets videoElementRef.current to null. In this case, we should NOT dispose
      // the player because the element will be re-attached during the second mount.
      // Only dispose when this is a TRUE unmount (component being removed from tree).
      if (!videoElementRef.current) {
        logger.debug('[CustomVideoPlayer] Cleanup skipped - video element ref is null (likely Strict Mode simulated unmount)');
        return;
      }

      // Only cleanup if player was actually initialized
      if (!playerRef.current) {
        logger.debug('[CustomVideoPlayer] Cleanup skipped - player not initialized');
        return;
      }

      logger.debug('[CustomVideoPlayer] Component unmounting, cleaning up...');
      isInitializingRef.current = false;

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

      // Cleanup touch feedback
      if (touchFeedbackCleanupRef.current) {
        touchFeedbackCleanupRef.current();
        touchFeedbackCleanupRef.current = null;
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

      // Cleanup quality levels
      if (qualityLevelsCleanupRef.current) {
        qualityLevelsCleanupRef.current();
        qualityLevelsCleanupRef.current = null;
      }

      // Cleanup performance monitoring
      if (performanceMonitorRef.current) {
        performanceMonitorRef.current.stop();
        performanceMonitorRef.current = null;
      }

      // Cleanup player
      disposeVideoPlayer(playerRef.current);
      playerRef.current = null;
      setPlayerReady(false);
    };
  }, []);

  /**
   * Whole-pixel frame (docs/specs/VIDEO-PLAYER.md section 3): a 16:9 box often has a fractional
   * height, which antialiases the bottom edge differently from the top. The frame's height is
   * set from its width and rounded.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      const width = frame.getBoundingClientRect().width;
      if (width > 0) frame.style.height = `${Math.round(width * (portrait ? 16 / 9 : 9 / 16))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [portrait, currentError]);

  /**
   * Mini player: on pages that offer it, while playing and the frame is almost scrolled away,
   * the video floats in the end corner. Closing pauses it until the frame is seen again.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !playerUi.miniPlayerAvailable || typeof IntersectionObserver === 'undefined') {
      setMini(false);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      const away = !entry.isIntersecting || entry.intersectionRatio < 0.15;
      if (!away) miniDismissedRef.current = false;
      setMini(away && isPlaying && !miniDismissedRef.current && window.innerWidth >= 640);
    }, { threshold: [0, 0.15, 0.5] });
    io.observe(frame);
    return () => io.disconnect();
  }, [playerUi.miniPlayerAvailable, isPlaying]);

  /**
   * Theatre on or off keeps the frame's top in view (lib/video/theatre-scroll.ts). It runs in the
   * same commit as the page's theatre layout, before paint, so the frame never shows off screen.
   * The floating mini player is already in view.
   */
  const theatreSeenRef = useRef(playerUi.theatre);
  useBrowserLayoutEffect(() => {
    if (theatreSeenRef.current === playerUi.theatre) return;
    theatreSeenRef.current = playerUi.theatre;
    if (!mini) keepFrameInView(frameRef.current);
  }, [playerUi.theatre, mini]);

  const closeMini = useCallback(() => {
    miniDismissedRef.current = true;
    setMini(false);
    playerRef.current?.pause();
  }, []);
  const returnFromMini = useCallback(() => {
    setMini(false);
    frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  const replay = useCallback(() => {
    setEnded(false);
    playerRef.current?.currentTime(0);
    void playerRef.current?.play();
  }, []);

  /**
   * Render error display if there's an error
   */
  if (currentError) {
    return (
      <div ref={frameRef} className={`custom-video-player ${className}`}>
        <ErrorDisplay
          onReport={playerUi.reportProblem ?? undefined}
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
    <div
      ref={frameRef}
      className={`custom-video-player aspect-video ${className}`}
      dir={dir}
      data-portrait={portrait || undefined}
      data-short={isShort || undefined}
      data-mini={mini || undefined}
      data-ended={ended || undefined}
    >
      {/* Accessibility: Hidden live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {playerReady ? t.player.ready : t.player.loading}
      </div>
      {/* #242: "Resuming at 3:42", announced once when the player opens there */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="player-resume-announcement">
        {resumeAnnouncement}
      </div>

      {/* Video player container */}
      <div data-vjs-player className="relative">
        <video
          ref={videoRefCallback}
          className="video-js vjs-big-play-centered"
          playsInline
          aria-label={ariaLabel || t.accessibility.videoPlayer}
          tabIndex={0}
        />

        {/* #242: persistent while it applies; no timer hides it */}
        {showStartOver && (
          <button
            type="button"
            className="vjs-start-over"
            data-testid="player-start-over"
            onClick={handleStartOver}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" className="vjs-start-over-icon">
              <path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
            <span>{t.resume.startOverButton}</span>
          </button>
        )}

        {ended && <EndScreen upNext={playerUi.upNext} onReplay={replay} t={t} dir={dir === 'rtl' ? 'rtl' : 'ltr'} />}
        {mini && <MiniPlayerButtons onClose={closeMini} onReturn={returnFromMini} t={t} />}

        {/* Real-time viewer count (WebSocket) */}
        {enableWebSocket && playerReady && (
          <ViewerCount
            count={viewerCount}
            isLive={isLive}
            isConnected={wsConnected}
            lang={lang}
            showWhenDisconnected={false}
            className="vjs-viewer-count-overlay"
          />
        )}
      </div>

      {playerReady && playerRef.current && (
        <SettingsMenu player={playerRef.current} lang={lang} onShowShortcuts={() => setIsKeyboardHelpOpen(true)} />
      )}
      {playerReady && playerRef.current && <ProgressTooltip player={playerRef.current} dir={dir === 'rtl' ? 'rtl' : 'ltr'} />}

      <KeyboardHelpModal
        isOpen={isKeyboardHelpOpen}
        onClose={() => setIsKeyboardHelpOpen(false)}
        lang={lang}
        playerElement={playerReady ? (playerRef.current?.el?.() as HTMLElement | undefined) : undefined}
      />
    </div>
  );
}
