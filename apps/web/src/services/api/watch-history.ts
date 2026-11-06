import { logger } from '@/lib/logger-client';
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
 * API Endpoints (api-videos):
 * - POST   /api/watch-history                     record a watch (creates entry)
 * - POST   /api/watch-history/:videoId/progress   update progress of an entry
 * - GET    /api/watch-history/:videoId/progress   get progress for resume
 * - GET    /api/watch-history                     list history (paginated)
 * - DELETE /api/watch-history/:videoId            remove one entry
 * - DELETE /api/watch-history                     clear all history
 */

import { StorageManager } from '@/lib/utils/storage';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';

/** Resolved per call: runtime config is injected after module evaluation. */
const apiBase = (): string => getApiUrl();

/**
 * Watch history entry as returned by GET /api/watch-history
 */
export interface WatchHistoryItem {
  id: string;
  userId: string;
  videoId: string;
  videoTitle: string;
  videoThumbnail?: string;
  videoDuration: number;
  channelId: string;
  channelName: string;
  firstWatchedAt: string;
  lastWatchedAt: string;
  watchCount: number;
  progress: number;
  completed: boolean;
  percentageWatched: number;
}

export interface WatchHistoryPage {
  entries: WatchHistoryItem[];
  total: number;
  hasMore: boolean;
  cursor?: string;
}

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
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      };
      const body = JSON.stringify({
        progress: progress.currentTime,
        duration: progress.duration,
      });

      // Update the existing entry; create it on first save (404)
      let response = await fetch(
        `${apiBase()}/api/watch-history/${encodeURIComponent(progress.videoId)}/progress`,
        { method: 'POST', headers, body }
      );

      if (response.status === 404) {
        response = await fetch(`${apiBase()}/api/watch-history`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            videoId: progress.videoId,
            progress: progress.currentTime,
            duration: progress.duration,
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: errorData.error || `Failed to save progress: ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to save progress:', error);
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
        `${apiBase()}/api/watch-history/${encodeURIComponent(videoId)}/progress`,
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

      const data: {
        videoId: string;
        progress: number;
        duration: number;
        completed: boolean;
        lastWatchedAt?: string;
      } = await response.json();
      return {
        videoId: data.videoId || videoId,
        currentTime: data.progress || 0,
        duration: data.duration || 0,
        completed: !!data.completed,
        timestamp: data.lastWatchedAt || new Date().toISOString(),
      };
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to get progress:', error);
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
        logger.warn('[WatchHistoryService] Failed to save watch progress to localStorage (quota exceeded)');

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
            logger.debug('[WatchHistoryService] Saved progress with reduced storage');
          }
        }
      } else if (process.env.NODE_ENV === 'development') {
        logger.debug('[WatchHistoryService] Saved progress locally:', progress);
      }
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to save progress locally:', error);
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
      logger.error('[WatchHistoryService] Failed to get progress from localStorage:', error);
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
      logger.warn('[WatchHistoryService] Failed to parse stored progress, resetting:', error);
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
   * @returns Promise resolving to sync results
   */
  static async syncLocalToAPI(
    authToken: string
  ): Promise<{ synced: number; failed: number }> {
    try {
      const stored = this.getStoredProgress();
      const remainingProgress: Record<string, WatchProgress> = { ...stored };

      let synced = 0;
      let failed = 0;

      for (const [videoId, progress] of Object.entries(stored)) {
        const result = await this.saveProgress(
          { ...progress },
          authToken
        );

        if (result.success) {
          synced++;
          // Remove successfully synced item from remaining progress
          delete remainingProgress[videoId];
        } else {
          failed++;
          // Keep failed item in localStorage for retry
        }
      }

      if (synced > 0 && process.env.NODE_ENV === 'development') {
        logger.debug(`[WatchHistoryService] Synced ${synced} items from localStorage to API`);
      }

      // Update localStorage with only the items that failed to sync
      if (Object.keys(remainingProgress).length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remainingProgress));
      }

      return { synced, failed };
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to sync localStorage to API:', error);
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
          `${apiBase()}/api/watch-history/${encodeURIComponent(videoId)}`,
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
      logger.error('[WatchHistoryService] Failed to clear progress:', error);
    }
  }

  /**
   * List the active account's watch history (newest first).
   * Uses the browser auth token (cookies are httpOnly).
   */
  static async list(
    params: { limit?: number; cursor?: string } = {}
  ): Promise<WatchHistoryPage | null> {
    try {
      const query = new URLSearchParams({ sort: 'newest', limit: String(params.limit ?? 20) });
      if (params.cursor) query.set('cursor', params.cursor);
      const response = await fetch(`${apiBase()}/api/watch-history?${query.toString()}`, {
        headers: await getClientAuthHeaders(),
      });
      if (!response.ok) {
        logger.warn('[WatchHistoryService] List failed', { status: response.status });
        return null;
      }
      return (await response.json()) as WatchHistoryPage;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to list history:', error);
      return null;
    }
  }

  /**
   * Remove a single video from the active account's watch history.
   */
  static async remove(videoId: string): Promise<boolean> {
    try {
      const response = await fetch(`${apiBase()}/api/watch-history/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        headers: await getClientAuthHeaders(),
      });
      if (!response.ok) {
        logger.warn('[WatchHistoryService] Remove failed', { videoId, status: response.status });
      }
      return response.ok;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to remove history entry:', error);
      return false;
    }
  }

  /**
   * Clear the active account's entire watch history.
   */
  static async clearAll(): Promise<boolean> {
    try {
      const response = await fetch(`${apiBase()}/api/watch-history`, {
        method: 'DELETE',
        headers: await getClientAuthHeaders(),
      });
      if (!response.ok) {
        logger.warn('[WatchHistoryService] Clear failed', { status: response.status });
      }
      return response.ok;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to clear history:', error);
      return false;
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
