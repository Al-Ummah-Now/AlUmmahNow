/**
 * Watch Progress Hook
 *
 * React hook for managing video watch progress with:
 * - Automatic progress saving (throttled to 10 seconds)
 * - Save on pause, seek, and video end events
 * - Nothing is saved until the viewer has really played the video for
 *   RESUME_MIN_WATCHED_SECONDS in this page: opening the page, a `t=` link,
 *   scrubbing without playing or a preview that never plays record nothing
 * - Device storage for signed-out users only (it is not tied to an account,
 *   so a signed-in user never resumes from another account's or a guest watch)
 * - Load saved progress on mount for resume functionality
 * - Efficient debouncing to prevent API spam
 *
 * Usage:
 * ```tsx
 * const { savedProgress, saveProgress, clearProgress } = useWatchProgress(
 *   videoId,
 *   player,
 *   userId,
 *   authToken
 * );
 * ```
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ExtendedPlayer } from '@/lib/video/videojs';
import { WatchHistoryService, WatchProgress } from '@/services/api/watch-history';
import { logger } from '@/lib/logger-client';
import { fetchClientAuthToken } from '@/lib/auth/client-token';
import { hasWatchedEnough, playbackStep } from '@/lib/video/resume';


interface UseWatchProgressOptions {
  /**
   * Enable debug logging
   * @default false
   */
  enableDebugLogging?: boolean;

  /**
   * Interval for automatic progress saving (milliseconds)
   * @default 10000 (10 seconds)
   */
  saveInterval?: number;

  /**
   * Minimum time change to trigger save (seconds)
   * Prevents saving for tiny seeks/changes
   * @default 1
   */
  minTimeChange?: number;
}

/**
 * Hook for managing video watch progress
 *
 * @param videoId - Video ID being watched
 * @param player - Video.js player instance
 * @param userId - User ID (undefined if not authenticated)
 * @param authToken - JWT authentication token (undefined if not authenticated)
 * @param options - Configuration options
 * @returns Object with saved progress data and control methods
 */
export function useWatchProgress(
  videoId: string,
  player: ExtendedPlayer | null,
  userId?: string,
  authToken?: string,
  options: UseWatchProgressOptions = {}
) {
  const {
    enableDebugLogging = false,
    saveInterval = 10000, // 10 seconds
    minTimeChange = 1, // 1 second minimum change
  } = options;

  const [savedProgress, setSavedProgress] = useState<WatchProgress | null>(null);
  // What was stored before this playback started (resume prompt). Unlike
  // savedProgress it is not overwritten by the saves of the current watch.
  const [loadedProgress, setLoadedProgress] = useState<WatchProgress | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const lastSavedPositionRef = useRef<number>(0);
  const isMountedRef = useRef(true);
  // Seconds of media actually played in this page, and the last position seen
  const watchedSecondsRef = useRef<number>(0);
  const lastPlaybackTimeRef = useRef<number | null>(null);

  // Mutex pattern to prevent race conditions
  const saveMutexRef = useRef<boolean>(false);
  const pendingSaveRef = useRef<{ progress: WatchProgress; force: boolean } | null>(null);

  /**
   * Log debug message if debug logging is enabled
   */
  const debugLog = useCallback((...args: unknown[]) => {
    if (enableDebugLogging) {
      logger.debug('[useWatchProgress]', ...args);
    }
  }, [enableDebugLogging]);

  /**
   * Token for API calls. Callers rarely pass `authToken` (auth cookies are
   * httpOnly), so a signed-in user's token is fetched from /api/auth/token.
   * Without this every signed-in watch went to device storage only and the
   * account's watch history stayed empty.
   */
  const resolveAuthToken = useCallback(async (): Promise<string | null> => {
    if (authToken) return authToken;
    if (!userId) return null;
    try {
      return await fetchClientAuthToken();
    } catch {
      return null;
    }
  }, [userId, authToken]);

  /**
   * Process the actual save operation (internal)
   * This should only be called when the mutex is acquired
   */
  const processSave = useCallback(async (progress: WatchProgress): Promise<void> => {
    if (!isMountedRef.current) return;

    try {
      const token = await resolveAuthToken();
      if (token) {
        const result = await WatchHistoryService.saveProgress(progress, token);
        if (result.success) {
          debugLog('Progress saved to API:', progress.currentTime, '/', progress.duration);
        } else {
          // Visible in production: a failing API save otherwise looks like a
          // working player while the account history stays empty.
          logger.warn('[useWatchProgress] watch-history save failed, kept on device:', result.error);
          await WatchHistoryService.saveLocal(progress);
        }
      } else {
        if (userId) {
          logger.warn('[useWatchProgress] signed in but no access token; watch progress kept on device');
        }
        await WatchHistoryService.saveLocal(progress);
        debugLog('Progress saved to localStorage:', progress.currentTime, '/', progress.duration);
      }

      if (isMountedRef.current) {
        setSavedProgress(progress);
      }
    } catch (error) {
      logger.warn('[useWatchProgress] watch-history save threw, kept on device:', error);
      // Save to localStorage as fallback
      await WatchHistoryService.saveLocal(progress);
      if (isMountedRef.current) {
        setSavedProgress(progress);
      }
    }
  }, [resolveAuthToken, debugLog, userId]);

  /**
   * Save watch progress to API or localStorage with mutex protection
   * This prevents race conditions when multiple save calls happen simultaneously
   */
  const saveProgress = useCallback(async (force = false) => {
    if (!player || !videoId) return;

    // Check if player is ready before accessing currentTime/duration
    // Wrap in try-catch to handle case where tech is disposed
    let readyState: number;
    try {
      readyState = player.readyState();
      if (readyState < 1) {
        debugLog('Player not ready yet, skipping save');
        return;
      }
    } catch (error) {
      // Player tech is null or disposed, skip save
      debugLog('Player tech not available, skipping save:', error);
      return;
    }

    const currentTime = player.currentTime();
    const duration = player.duration();

    // Validate currentTime and duration
    if (currentTime === null || currentTime === undefined || isNaN(currentTime)) {
      debugLog('Invalid currentTime, skipping save');
      return;
    }

    if (!duration || isNaN(duration) || duration === 0) {
      return;
    }

    if (!WatchHistoryService.shouldSaveProgress(duration)) {
      debugLog('Video too short, skipping save');
      return;
    }

    if (!hasWatchedEnough(watchedSecondsRef.current)) {
      debugLog('Not played long enough yet, skipping save:', watchedSecondsRef.current);
      return;
    }

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    const positionChange = Math.abs(currentTime - lastSavedPositionRef.current);

    if (
      !force &&
      timeSinceLastSave < saveInterval &&
      positionChange < minTimeChange
    ) {
      return;
    }

    const progress: WatchProgress = {
      videoId,
      userId,
      currentTime,
      duration,
      completed: WatchHistoryService.isCompleted(currentTime, duration),
      timestamp: new Date().toISOString(),
    };

    // If a save is already in progress, queue this one
    if (saveMutexRef.current) {
      debugLog('Save in progress, queueing current progress:', currentTime);
      pendingSaveRef.current = { progress, force };
      return;
    }

    // Acquire mutex
    saveMutexRef.current = true;
    debugLog('Acquired mutex for save:', currentTime);

    // Update last save tracking
    lastSaveTimeRef.current = now;
    lastSavedPositionRef.current = currentTime;

    try {
      // Process the current save
      await processSave(progress);

      // Process any pending save that accumulated while we were saving
      // This ensures we always save the latest position
      while (pendingSaveRef.current && isMountedRef.current) {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;

        debugLog('Processing pending save:', pending.progress.currentTime);

        // Update tracking for the pending save
        lastSaveTimeRef.current = Date.now();
        lastSavedPositionRef.current = pending.progress.currentTime;

        await processSave(pending.progress);
      }
    } finally {
      // Release mutex
      saveMutexRef.current = false;
      debugLog('Released mutex');
    }
  }, [player, videoId, userId, saveInterval, minTimeChange, debugLog, processSave]);

  /**
   * Clear saved progress for this video
   */
  const clearProgress = useCallback(async () => {
    await WatchHistoryService.clearProgress(videoId, (await resolveAuthToken()) ?? undefined);
    setSavedProgress(null);
    lastSaveTimeRef.current = 0;
    lastSavedPositionRef.current = 0;
    debugLog('Progress cleared');
  }, [videoId, resolveAuthToken, debugLog]);

  /**
   * Load saved progress on mount
   */
  useEffect(() => {
    let mounted = true;

    const loadProgress = async () => {
      if (!videoId) return;
      setLoadedProgress(null);
      watchedSecondsRef.current = 0;
      lastPlaybackTimeRef.current = null;

      let progress: WatchProgress | null = null;

      if (userId) {
        // Signed in: the account's progress only. Device storage holds no
        // user id, so it could be a guest watch or another account's.
        const token = await resolveAuthToken();
        if (token) {
          progress = await WatchHistoryService.getProgress(videoId, token);
          debugLog('Loaded progress from API:', progress);
        }
      } else {
        progress = await WatchHistoryService.getLocal(videoId);
        debugLog('Loaded progress from device storage:', progress);
      }

      if (mounted && progress) {
        setSavedProgress(progress);
        setLoadedProgress(progress);
      }
    };

    void loadProgress();

    return () => {
      mounted = false;
    };
  }, [videoId, userId, resolveAuthToken, debugLog]);

  /**
   * Setup player event listeners for automatic progress saving
   */
  useEffect(() => {
    if (!player) return;

    // Start the periodic save as soon as the player is attached. The player
    // usually reaches the hook after video.js 'ready' already fired while the
    // media is still loading (readyState 0); waiting with one('ready') then
    // never started the interval, and a watch that was never paused was never
    // saved. saveProgress itself skips until the media has metadata.
    debugLog('Player attached, starting progress tracking');
    const timeUpdateInterval = setInterval(() => {
      void saveProgress(false);
    }, saveInterval);

    const handlePause = () => {
      debugLog('Player paused, saving progress');
      void saveProgress(true);
    };

    const handleEnded = () => {
      debugLog('Video ended, saving final progress');
      void saveProgress(true);
    };

    const handleSeeked = () => {
      debugLog('Player seeked, saving progress');
      void saveProgress(true);
    };

    // Count only media that actually plays: seeks, rewinds and paused
    // timeupdates (e.g. a programmatic seek before play) add nothing.
    const handleTimeUpdate = () => {
      let time: number;
      let playing: boolean;
      try {
        time = player.currentTime() ?? NaN;
        playing = !player.paused() && !player.seeking();
      } catch {
        return;
      }
      if (playing) watchedSecondsRef.current += playbackStep(lastPlaybackTimeRef.current, time);
      lastPlaybackTimeRef.current = Number.isFinite(time) ? time : null;
    };

    player.on('pause', handlePause);
    player.on('ended', handleEnded);
    player.on('seeked', handleSeeked);
    player.on('timeupdate', handleTimeUpdate);

    return () => {
      clearInterval(timeUpdateInterval);

      player.off('pause', handlePause);
      player.off('ended', handleEnded);
      player.off('seeked', handleSeeked);
      player.off('timeupdate', handleTimeUpdate);

      // Save final progress on cleanup, but only if not already saving
      if (!saveMutexRef.current) {
        void saveProgress(true);
      }
    };
  }, [player, saveProgress, saveInterval, debugLog]);

  /**
   * Track mounted state
   */
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    savedProgress,
    loadedProgress,
    saveProgress: (force = true) => saveProgress(force),
    clearProgress,
  };
}
