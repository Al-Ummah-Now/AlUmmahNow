/**
 * Watch History Service
 *
 * Handles watch progress tracking for video playback.
 * Features:
 * - Save watch progress to API (authenticated users)
 * - Load saved progress for resume functionality
 * - localStorage fallback for unauthenticated users
 * - Sync localStorage to API on authentication
 * - Efficient throttling to prevent API spam
 * - Automatic quota management with StorageManager
 *
 * API Endpoint: POST /api/profile/watch-history
 */

import { StorageManager } from '@/lib/utils/storage';

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

/**
 * Watch progress data structure
 */
export interface WatchProgress {
  videoId: string;
  userId?: string;
  currentTime: number;
  duration: number;
  completed: boolean; // true if watched >90%
  timestamp: string; // ISO date string
}

/**
 * LocalStorage key for storing watch progress
 */
const STORAGE_KEY = 'watchProgress';

/**
 * Watch History Service for managing video playback progress
 */
export class WatchHistoryService {
  /**
   * Save watch progress to API (authenticated users only)
   *
   * @param progress - Watch progress data
   * @param authToken - JWT authentication token
   * @returns Promise resolving to success status
   */
  static async saveProgress(
    progress: WatchProgress,
    authToken: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${baseUrl}/api/profile/watch-history`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            videoId: progress.videoId,
            currentTime: progress.currentTime,
            duration: progress.duration,
            completed: progress.completed,
            timestamp: progress.timestamp,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: errorData.error || `Failed to save progress: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      console.error('[WatchHistoryService] Failed to save progress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  /**
   * Get watch progress from API (authenticated users only)
   *
   * @param videoId - Video ID to get progress for
   * @param authToken - JWT authentication token
   * @returns Promise resolving to watch progress or null
   */
  static async getProgress(
    videoId: string,
    authToken: string
  ): Promise<WatchProgress | null> {
    try {
      const response = await fetch(
        `${baseUrl}/api/profile/watch-history/${videoId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get progress: ${response.statusText}`);
      }

      const data = await response.json();
      return data.result || data;
    } catch (error) {
      console.error('[WatchHistoryService] Failed to get progress:', error);
      return null;
    }
  }

  /**
   * Save watch progress to localStorage (fallback for unauthenticated users)
   * Uses StorageManager for safe storage with quota management
   *
   * @param progress - Watch progress data
   */
  static saveLocal(progress: WatchProgress): void {
    try {
      const stored = this.getStoredProgress();
      stored[progress.videoId] = progress;

      const jsonStr = JSON.stringify(stored);
      const success = StorageManager.safeSetItem(STORAGE_KEY, jsonStr);

      if (!success) {
        console.warn('[WatchHistoryService] Failed to save watch progress to localStorage (quota exceeded)');

        // Try to save just this video's progress by removing oldest entries
        const entries = Object.entries(stored);
        if (entries.length > 10) {
          // Sort by timestamp, keep only 10 most recent including current
          entries.sort((a, b) => {
            const timeA = new Date(a[1].timestamp).getTime();
            const timeB = new Date(b[1].timestamp).getTime();
            return timeB - timeA;
          });

          const recentEntries = entries.slice(0, 9); // Keep 9, add current
          const reducedStored = Object.fromEntries(recentEntries);
          reducedStored[progress.videoId] = progress;

          // Try again with reduced data
          const reducedJson = JSON.stringify(reducedStored);
          const retrySuccess = StorageManager.safeSetItem(STORAGE_KEY, reducedJson);

          if (retrySuccess && process.env.NODE_ENV === 'development') {
            console.log('[WatchHistoryService] Saved progress with reduced storage');
          }
        }
      } else if (process.env.NODE_ENV === 'development') {
        console.log('[WatchHistoryService] Saved progress locally:', progress);
      }
    } catch (error) {
      console.error('[WatchHistoryService] Failed to save progress locally:', error);
    }
  }

  /**
   * Get watch progress from localStorage
   *
   * @param videoId - Video ID to get progress for
   * @returns Watch progress or null if not found
   */
  static getLocal(videoId: string): WatchProgress | null {
    try {
      const stored = this.getStoredProgress();
      return stored[videoId] || null;
    } catch (error) {
      console.error('[WatchHistoryService] Failed to get progress from localStorage:', error);
      return null;
    }
  }

  /**
   * Get all stored progress from localStorage
   *
   * @returns Object mapping video IDs to watch progress
   */
  private static getStoredProgress(): Record<string, WatchProgress> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return {};
      }

      const parsed = JSON.parse(stored);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (error) {
      console.warn('[WatchHistoryService] Failed to parse stored progress, resetting:', error);
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
  }

  /**
   * Sync all localStorage progress to API after authentication
   *
   * This method should be called when a user logs in to sync their
   * watch history from localStorage to the server.
   *
   * @param authToken - JWT authentication token
   * @param userId - User ID for filtering progress
   * @returns Promise resolving to sync results
   */
  static async syncLocalToAPI(
    authToken: string,
    userId: string
  ): Promise<{ synced: number; failed: number }> {
    try {
      const stored = this.getStoredProgress();
      const progressArray = Object.values(stored);

      let synced = 0;
      let failed = 0;

      for (const progress of progressArray) {
        const result = await this.saveProgress(
          { ...progress, userId },
          authToken
        );

        if (result.success) {
          synced++;
        } else {
          failed++;
        }
      }

      if (synced > 0 && process.env.NODE_ENV === 'development') {
        console.log(`[WatchHistoryService] Synced ${synced} items from localStorage to API`);
      }

      if (failed === 0) {
        localStorage.removeItem(STORAGE_KEY);
      }

      return { synced, failed };
    } catch (error) {
      console.error('[WatchHistoryService] Failed to sync localStorage to API:', error);
      return { synced: 0, failed: Object.keys(this.getStoredProgress()).length };
    }
  }

  /**
   * Clear progress for a specific video
   *
   * @param videoId - Video ID to clear progress for
   * @param authToken - Optional JWT token for authenticated users
   */
  static async clearProgress(videoId: string, authToken?: string): Promise<void> {
    try {
      if (authToken) {
        await fetch(
          `${baseUrl}/api/profile/watch-history/${videoId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${authToken}`,
            },
          }
        );
      }

      const stored = this.getStoredProgress();
      delete stored[videoId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      console.error('[WatchHistoryService] Failed to clear progress:', error);
    }
  }

  /**
   * Check if progress should be saved for a video
   *
   * Don't save progress for very short videos (< 30 seconds)
   *
   * @param duration - Video duration in seconds
   * @returns True if progress should be saved
   */
  static shouldSaveProgress(duration: number): boolean {
    const MIN_DURATION = 30; // 30 seconds
    return duration >= MIN_DURATION;
  }

  /**
   * Calculate if video is completed (>90% watched)
   *
   * @param currentTime - Current playback position in seconds
   * @param duration - Total video duration in seconds
   * @returns True if video is considered completed
   */
  static isCompleted(currentTime: number, duration: number): boolean {
    const COMPLETION_THRESHOLD = 0.9; // 90%
    return currentTime / duration >= COMPLETION_THRESHOLD;
  }
}
