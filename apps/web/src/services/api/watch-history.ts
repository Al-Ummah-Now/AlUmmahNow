import { logger } from '@/lib/logger-client';
/**
 * Watch History Service
 *
 * Handles watch progress tracking for video playback.
 * Features:
 * - Save watch progress to API (authenticated users)
 * - Load saved progress for resume functionality
 * - Encrypted on-device fallback for unauthenticated users (EncryptedStorage)
 * - Sync device progress to API on authentication
 * - Efficient throttling to prevent API spam
 * - Retention: 90 days / 50 videos on the device
 *
 * API Endpoints (api-videos):
 * - POST   /api/watch-history                     record a watch (creates entry)
 * - POST   /api/watch-history/:videoId/progress   update progress of an entry
 * - GET    /api/watch-history/:videoId/progress   get progress for resume
 * - GET    /api/watch-history                     list history (paginated)
 * - DELETE /api/watch-history/:videoId            remove one entry
 * - DELETE /api/watch-history                     clear all history
 */

import { EncryptedStorage } from '@/lib/storage/EncryptedStorage';
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
 * Storage key for watch progress kept on the device (anonymous users). The
 * encrypted value lives under EncryptedStorage's prefix; the bare key is the
 * legacy plaintext location that is migrated and removed on first access.
 */
const STORAGE_KEY = 'watchProgress';

let warnedMalformedPage = false;

/**
 * A history page whose `entries` is not an array (an older API, a proxy error
 * body, a test mock) is read as an empty page instead of crashing every
 * caller that maps over it. Warned once per page load, not on every call.
 */
export function toWatchHistoryPage(body: unknown): WatchHistoryPage {
  const page = (body && typeof body === 'object' ? body : {}) as Partial<WatchHistoryPage>;
  if (!Array.isArray(page.entries)) {
    if (!warnedMalformedPage) {
      warnedMalformedPage = true;
      logger.warn('[WatchHistoryService] History page without an entries array; showing none', {
        entriesType: page.entries === null ? 'null' : typeof page.entries,
      });
    }
    return { entries: [], total: 0, hasMore: false };
  }
  return {
    ...page,
    entries: page.entries,
    total: typeof page.total === 'number' ? page.total : page.entries.length,
    hasMore: page.hasMore === true,
  } as WatchHistoryPage;
}

/** Test hook: lets the once-per-load warning fire again. */
export function resetWatchHistoryPageWarning(): void {
  warnedMalformedPage = false;
}

/** Retention for on-device watch progress (see docs/compliance/GDPR.md). */
export const LOCAL_PROGRESS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Upper bound on videos remembered on the device. */
export const LOCAL_PROGRESS_MAX_ENTRIES = 50;

/** Keep only the fields resume needs: no user id is stored on the device. */
function minimizeLocalProgress(progress: WatchProgress): WatchProgress {
  return {
    videoId: progress.videoId,
    currentTime: progress.currentTime,
    duration: progress.duration,
    completed: progress.completed,
    timestamp: progress.timestamp,
  };
}

/**
 * Apply the on-device retention policy: drop entries older than
 * LOCAL_PROGRESS_RETENTION_MS and keep the LOCAL_PROGRESS_MAX_ENTRIES newest.
 */
export function applyLocalProgressRetention(
  stored: Record<string, WatchProgress>,
  now = Date.now()
): Record<string, WatchProgress> {
  const cutoff = now - LOCAL_PROGRESS_RETENTION_MS;
  const fresh = Object.values(stored).filter(entry => {
    const time = new Date(entry?.timestamp).getTime();
    return entry && typeof entry.videoId === 'string' && Number.isFinite(time) && time >= cutoff;
  });
  fresh.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return Object.fromEntries(
    fresh.slice(0, LOCAL_PROGRESS_MAX_ENTRIES).map(entry => [entry.videoId, minimizeLocalProgress(entry)])
  );
}

/** Read and delete the pre-encryption plaintext entry, if any. */
function readLegacyPlaintextProgress(): Record<string, WatchProgress> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    localStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, WatchProgress>) : null;
  } catch {
    return null;
  }
}

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

      // Update the existing entry; the API says recorded: false on the first save
      let response = await fetch(
        `${apiBase()}/api/watch-history/${encodeURIComponent(progress.videoId)}/progress`,
        { method: 'POST', headers, body }
      );

      const saved = response.ok ? await response.json().catch(() => null) : null;
      // 404 is the previous API's answer, for the window while the two deploy
      if (response.status === 404 || saved?.recorded === false) {
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
        progress: number | null;
        duration: number;
        completed: boolean;
        lastWatchedAt?: string;
      } = await response.json();
      if (data.progress === null) return null;
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
   * Save watch progress on this device (fallback for unauthenticated users).
   *
   * Stored encrypted (EncryptedStorage) because viewing history is personal
   * data. Only what resume needs is kept (no user id), at most
   * LOCAL_PROGRESS_MAX_ENTRIES entries, each for LOCAL_PROGRESS_RETENTION_MS.
   *
   * @param progress - Watch progress data
   */
  static async saveLocal(progress: WatchProgress): Promise<void> {
    try {
      const stored = await this.getStoredProgress();
      stored[progress.videoId] = minimizeLocalProgress(progress);
      await this.writeStoredProgress(stored);
      if (process.env.NODE_ENV === 'development') {
        logger.debug('[WatchHistoryService] Saved progress locally (encrypted)', { videoId: progress.videoId });
      }
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to save progress locally:', error);
    }
  }

  /**
   * Get watch progress saved on this device
   *
   * @param videoId - Video ID to get progress for
   * @returns Watch progress or null if not found
   */
  static async getLocal(videoId: string): Promise<WatchProgress | null> {
    try {
      const stored = await this.getStoredProgress();
      return stored[videoId] || null;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to get local progress:', error);
      return null;
    }
  }

  /**
   * Read all locally stored progress, migrating the legacy plaintext
   * `watchProgress` localStorage entry into encrypted storage on first access
   * and applying the retention policy.
   */
  private static async getStoredProgress(): Promise<Record<string, WatchProgress>> {
    const legacy = readLegacyPlaintextProgress();
    const encrypted = (await EncryptedStorage.getItem<Record<string, WatchProgress>>(STORAGE_KEY)) ?? {};
    const merged = legacy ? { ...legacy, ...encrypted } : encrypted;
    const pruned = applyLocalProgressRetention(merged);
    if (legacy || Object.keys(pruned).length !== Object.keys(encrypted).length) {
      await this.writeStoredProgress(pruned);
    }
    return pruned;
  }

  private static async writeStoredProgress(stored: Record<string, WatchProgress>): Promise<void> {
    const pruned = applyLocalProgressRetention(stored);
    if (Object.keys(pruned).length === 0) {
      EncryptedStorage.removeItem(STORAGE_KEY);
      return;
    }
    await EncryptedStorage.setItem(STORAGE_KEY, pruned, { ttlMs: LOCAL_PROGRESS_RETENTION_MS });
  }

  /**
   * Sync all locally stored progress to the API after authentication, then
   * remove what was synced from the device.
   *
   * @param authToken - JWT authentication token
   * @returns Promise resolving to sync results
   */
  static async syncLocalToAPI(
    authToken: string
  ): Promise<{ synced: number; failed: number }> {
    try {
      const stored = await this.getStoredProgress();
      const remainingProgress: Record<string, WatchProgress> = { ...stored };

      let synced = 0;
      let failed = 0;

      for (const [videoId, progress] of Object.entries(stored)) {
        const result = await this.saveProgress({ ...progress }, authToken);
        if (result.success) {
          synced++;
          delete remainingProgress[videoId];
        } else {
          failed++;
        }
      }

      if (synced > 0 && process.env.NODE_ENV === 'development') {
        logger.debug(`[WatchHistoryService] Synced ${synced} items from device storage to API`);
      }

      await this.writeStoredProgress(remainingProgress);
      return { synced, failed };
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to sync local progress to API:', error);
      return { synced: 0, failed: 0 };
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

      const stored = await this.getStoredProgress();
      delete stored[videoId];
      await this.writeStoredProgress(stored);
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to clear progress:', error);
    }
  }

  /** Remove all watch progress stored on this device. */
  static clearLocal(): void {
    EncryptedStorage.removeItem(STORAGE_KEY);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: nothing to clear
    }
  }
  /**
   * List the active account's watch history (newest first).
   * Uses the browser auth token (cookies are httpOnly).
   */
  static async list(
    params: { limit?: number; cursor?: string; completed?: boolean } = {}
  ): Promise<WatchHistoryPage | null> {
    try {
      const query = new URLSearchParams({ sort: 'newest', limit: String(params.limit ?? 20) });
      if (params.cursor) query.set('cursor', params.cursor);
      if (params.completed !== undefined) query.set('completed', String(params.completed));
      const response = await fetch(`${apiBase()}/api/watch-history?${query.toString()}`, {
        headers: await getClientAuthHeaders(),
      });
      if (!response.ok) {
        logger.warn('[WatchHistoryService] List failed', { status: response.status });
        return null;
      }
      return toWatchHistoryPage(await response.json());
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
   * Whether recording is paused for the active account (null on failure).
   */
  static async getPaused(): Promise<boolean | null> {
    try {
      const response = await fetch(`${apiBase()}/api/watch-history/settings`, {
        headers: await getClientAuthHeaders(),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { paused?: boolean };
      return data.paused === true;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to load history settings:', error);
      return null;
    }
  }

  /**
   * Pause or resume recording for the active account. Returns the stored
   * value, or null on failure.
   */
  static async setPaused(paused: boolean): Promise<boolean | null> {
    try {
      const response = await fetch(`${apiBase()}/api/watch-history/settings`, {
        method: 'PUT',
        headers: { ...(await getClientAuthHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      });
      if (!response.ok) {
        logger.warn('[WatchHistoryService] Pause toggle failed', { status: response.status });
        return null;
      }
      const data = (await response.json()) as { paused?: boolean };
      return data.paused === true;
    } catch (error) {
      logger.error('[WatchHistoryService] Failed to change history settings:', error);
      return null;
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
