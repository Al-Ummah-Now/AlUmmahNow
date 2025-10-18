/**
 * Watch Progress Hook
 *
 * React hook for managing video watch progress with:
 * - Automatic progress saving (throttled to 10 seconds)
 * - Save on pause, seek, and video end events
 * - localStorage fallback for unauthenticated users
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
  const lastSaveTimeRef = useRef<number>(0);
  const lastSavedPositionRef = useRef<number>(0);
  const isMountedRef = useRef(true);

  /**
   * Log debug message if debug logging is enabled
   */
  const debugLog = useCallback((...args: unknown[]) => {
    if (enableDebugLogging) {
      console.log('[useWatchProgress]', ...args);
    }
  }, [enableDebugLogging]);

  /**
   * Save watch progress to API or localStorage
   */
  const saveProgress = useCallback(async (force = false) => {
    if (!player || !videoId) return;

    const currentTime = player.currentTime();
    const duration = player.duration();

    if (!duration || isNaN(duration) || duration === 0) {
      return;
    }

    if (!WatchHistoryService.shouldSaveProgress(duration)) {
      debugLog('Video too short, skipping save');
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

    lastSaveTimeRef.current = now;
    lastSavedPositionRef.current = currentTime;

    if (userId && authToken) {
      const result = await WatchHistoryService.saveProgress(progress, authToken);
      if (result.success) {
        debugLog('Progress saved to API:', currentTime, '/', duration);
      } else {
        debugLog('Failed to save to API, falling back to localStorage:', result.error);
        WatchHistoryService.saveLocal(progress);
      }
    } else {
      WatchHistoryService.saveLocal(progress);
      debugLog('Progress saved to localStorage:', currentTime, '/', duration);
    }

    setSavedProgress(progress);
  }, [player, videoId, userId, authToken, saveInterval, minTimeChange, debugLog]);

  /**
   * Clear saved progress for this video
   */
  const clearProgress = useCallback(async () => {
    await WatchHistoryService.clearProgress(videoId, authToken);
    setSavedProgress(null);
    lastSaveTimeRef.current = 0;
    lastSavedPositionRef.current = 0;
    debugLog('Progress cleared');
  }, [videoId, authToken, debugLog]);

  /**
   * Load saved progress on mount
   */
  useEffect(() => {
    let mounted = true;

    const loadProgress = async () => {
      if (!videoId) return;

      let progress: WatchProgress | null = null;

      if (userId && authToken) {
        progress = await WatchHistoryService.getProgress(videoId, authToken);
        debugLog('Loaded progress from API:', progress);
      }

      if (!progress) {
        progress = WatchHistoryService.getLocal(videoId);
        debugLog('Loaded progress from localStorage:', progress);
      }

      if (mounted && progress) {
        setSavedProgress(progress);
      }
    };

    void loadProgress();

    return () => {
      mounted = false;
    };
  }, [videoId, userId, authToken, debugLog]);

  /**
   * Setup player event listeners for automatic progress saving
   */
  useEffect(() => {
    if (!player) return;

    let timeUpdateInterval: ReturnType<typeof setInterval> | undefined;

    const handleReady = () => {
      debugLog('Player ready, starting progress tracking');

      timeUpdateInterval = setInterval(() => {
        void saveProgress(false);
      }, saveInterval);
    };

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

    if (player.readyState() >= 1) {
      handleReady();
    } else {
      player.one('ready', handleReady);
    }

    player.on('pause', handlePause);
    player.on('ended', handleEnded);
    player.on('seeked', handleSeeked);

    return () => {
      if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
      }

      player.off('ready', handleReady);
      player.off('pause', handlePause);
      player.off('ended', handleEnded);
      player.off('seeked', handleSeeked);

      void saveProgress(true);
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
    saveProgress: () => saveProgress(true),
    clearProgress,
  };
}
