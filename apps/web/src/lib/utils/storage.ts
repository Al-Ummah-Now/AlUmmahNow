import { logger } from '@/lib/logger-server';

/**
 * Storage Manager Utility
 *
 * Manages localStorage with quota enforcement, automatic cleanup,
 * and safe storage operations to prevent QuotaExceededError.
 *
 * Features:
 * - Size monitoring and quota enforcement (4MB limit)
 * - Automatic cleanup of old data when approaching quota
 * - Emergency cleanup when quota is exceeded
 * - Safe storage operations with error handling
 * - Configurable data retention policies
 */



/**
 * Storage Manager class for safe localStorage operations
 */
export class StorageManager {
  // Safe limit: 4MB (browser typically allows 5-10MB)
  private static readonly MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

  // Warning threshold: 80% of max size
  private static readonly WARNING_THRESHOLD = 0.8;

  // Default retention period: 30 days
  private static readonly DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  /**
   * Get approximate localStorage size in bytes
   * Note: This is an estimation as JavaScript strings use UTF-16 encoding
   */
  static getStorageSize(): number {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 0;
    }

    let size = 0;
    try {
      // Use localStorage.length and key() method to iterate through stored items
      // This works better with mocks than Object.keys()
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          const value = window.localStorage.getItem(key);
          if (value) {
            // UTF-16 encoding: 2 bytes per character
            size += (key.length + value.length) * 2;
          }
        }
      }
    } catch (error) {
      logger.warn('[StorageManager] Error calculating storage size:', error);
    }

    return size;
  }

  /**
   * Get storage usage as a percentage
   */
  static getStorageUsagePercentage(): number {
    const size = this.getStorageSize();
    return (size / this.MAX_SIZE_BYTES) * 100;
  }

  /**
   * Check if storage is approaching quota
   */
  static isApproachingQuota(): boolean {
    const size = this.getStorageSize();
    return size > (this.MAX_SIZE_BYTES * this.WARNING_THRESHOLD);
  }

  /**
   * Check if adding data would exceed quota
   */
  static canStore(key: string, value: string): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }

    const newItemSize = (key.length + value.length) * 2; // UTF-16
    const currentSize = this.getStorageSize();
    return (currentSize + newItemSize) < this.MAX_SIZE_BYTES;
  }

  /**
   * Clean up old data from specific keys
   *
   * @param keysToClean - Array of localStorage keys to clean
   * @param maxAge - Maximum age in milliseconds (default: 30 days)
   */
  static cleanupOldData(
    keysToClean: string[],
    maxAge: number = this.DEFAULT_MAX_AGE_MS
  ): number {
    if (typeof window === 'undefined' || !window.localStorage) {
      return 0;
    }

    const now = Date.now();
    let itemsRemoved = 0;

    keysToClean.forEach(key => {
      try {
        const data = localStorage.getItem(key);
        if (!data) return;

        const parsed = JSON.parse(data);

        // Handle object with nested items (like watchProgress)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const cleaned: Record<string, unknown> = {};
          let hasChanges = false;

          Object.keys(parsed).forEach(subKey => {
            const item = parsed[subKey];

            // Check if item has timestamp and is old
            const timestamp = this.extractTimestamp(item);
            if (timestamp) {
              const age = now - timestamp;
              if (age > maxAge) {
                hasChanges = true;
                itemsRemoved++;
              } else {
                cleaned[subKey] = item;
              }
            } else {
              // Keep items without timestamps
              cleaned[subKey] = item;
            }
          });

          if (hasChanges) {
            // Only update if we actually removed items
            if (Object.keys(cleaned).length > 0) {
              localStorage.setItem(key, JSON.stringify(cleaned));
            } else {
              // Remove key entirely if no items left
              localStorage.removeItem(key);
            }
          }
        }
        // Handle arrays or other data structures with timestamps
        else if (parsed && typeof parsed === 'object') {
          const timestamp = this.extractTimestamp(parsed);
          if (timestamp) {
            const age = now - timestamp;
            if (age > maxAge) {
              localStorage.removeItem(key);
              itemsRemoved++;
            }
          }
        }
      } catch (error) {
        logger.warn(`[StorageManager] Failed to cleanup ${key}:`, error);
      }
    });

    if (itemsRemoved > 0) {
      logger.debug(`[StorageManager] Cleaned up ${itemsRemoved} old items`);
    }

    return itemsRemoved;
  }

  /**
   * Extract timestamp from an object
   */
  private static extractTimestamp(item: unknown): number | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const record = item as Record<string, unknown>;

    // Check for various timestamp formats
    if ('timestamp' in record) {
      if (typeof record.timestamp === 'number') {
        return record.timestamp;
      }
      if (typeof record.timestamp === 'string') {
        const parsed = Date.parse(record.timestamp);
        return isNaN(parsed) ? null : parsed;
      }
    }

    if ('expiresAt' in record && typeof record.expiresAt === 'number') {
      return record.expiresAt;
    }

    return null;
  }

  /**
   * Safe localStorage.setItem with quota handling
   *
   * @param key - Storage key
   * @param value - String value to store
   * @returns true if successfully stored, false otherwise
   */
  static safeSetItem(key: string, value: string): boolean {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }

    try {
      // Check size first
      if (!this.canStore(key, value)) {
        logger.warn('[StorageManager] Storage quota would be exceeded, attempting cleanup...');

        // Try cleanup with default keys
        const defaultKeys = ['watchProgress', 'video_views_tracked', 'videoAnalytics'];
        this.cleanupOldData(defaultKeys, this.DEFAULT_MAX_AGE_MS);

        // Check again after cleanup
        if (!this.canStore(key, value)) {
          logger.warn('[StorageManager] Storage quota still exceeded after cleanup');

          // Try emergency cleanup
          this.emergencyCleanup();

          // Final check
          if (!this.canStore(key, value)) {
            logger.error('[StorageManager] Cannot store item, quota exceeded even after emergency cleanup');
            return false;
          }
        }
      }

      // Attempt to store
      localStorage.setItem(key, value);

      // Log warning if approaching quota
      if (this.isApproachingQuota()) {
        const usage = this.getStorageUsagePercentage();
        logger.warn(`[StorageManager] Storage usage at ${usage.toFixed(1)}% of quota`);
      }

      return true;
    } catch (error: unknown) {
      const err = error as { name?: string; code?: number };
      if (err?.name === 'QuotaExceededError' ||
          err?.code === 22 || // QUOTA_EXCEEDED_ERR
          err?.code === 1014) { // NS_ERROR_DOM_QUOTA_REACHED (Firefox)
        logger.error('[StorageManager] QuotaExceededError caught, running emergency cleanup');
        this.emergencyCleanup();

        // Try one more time after emergency cleanup
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (retryError) {
          logger.error('[StorageManager] Failed to store even after emergency cleanup:', retryError);
          return false;
        }
      } else {
        logger.error('[StorageManager] Storage error:', error);
        return false;
      }
    }
  }

  /**
   * Emergency cleanup - keep only most recent data
   */
  private static emergencyCleanup(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    logger.warn('[StorageManager] Running emergency localStorage cleanup');

    try {
      // Priority 1: Clean up watch progress (keep only 10 most recent)
      const watchProgress = localStorage.getItem('watchProgress');
      if (watchProgress) {
        try {
          const parsed = JSON.parse(watchProgress);
          const entries = Object.entries(parsed);

          // Sort by timestamp, keep only 10 most recent
          entries.sort((a: [string, unknown], b: [string, unknown]) => {
            const timeA = this.extractTimestamp(a[1]) || 0;
            const timeB = this.extractTimestamp(b[1]) || 0;
            return timeB - timeA; // Most recent first
          });

          const recentEntries = entries.slice(0, 10);
          const cleaned = Object.fromEntries(recentEntries);
          localStorage.setItem('watchProgress', JSON.stringify(cleaned));
        } catch (error) {
          logger.error('[StorageManager] Failed to clean watchProgress:', error);
          localStorage.removeItem('watchProgress');
        }
      }

      // Priority 2: Clean up video views (keep only last 24 hours)
      const videoViews = localStorage.getItem('video_views_tracked');
      if (videoViews) {
        try {
          const parsed = JSON.parse(videoViews);
          const now = Date.now();
          const oneDayAgo = now - (24 * 60 * 60 * 1000);

          const cleaned: Record<string, number> = {};
          Object.entries(parsed).forEach(([videoId, timestamp]) => {
            if (typeof timestamp === 'number' && timestamp > oneDayAgo) {
              cleaned[videoId] = timestamp;
            }
          });

          if (Object.keys(cleaned).length > 0) {
            localStorage.setItem('video_views_tracked', JSON.stringify(cleaned));
          } else {
            localStorage.removeItem('video_views_tracked');
          }
        } catch (error) {
          logger.error('[StorageManager] Failed to clean video_views_tracked:', error);
          localStorage.removeItem('video_views_tracked');
        }
      }

      // Priority 3: Remove non-essential keys
      const nonEssentialKeys = [
        'videoAnalytics',
        'debug',
        'temp',
        'cache'
      ];

      nonEssentialKeys.forEach(key => {
        try {
          if (localStorage.getItem(key)) {
            localStorage.removeItem(key);
          }
        } catch (error) {
          logger.warn(`[StorageManager] Failed to remove ${key}:`, error);
        }
      });

      const newUsage = this.getStorageUsagePercentage();
      logger.debug(`[StorageManager] Emergency cleanup complete. New usage: ${newUsage.toFixed(1)}%`);
    } catch (error) {
      logger.error('[StorageManager] Emergency cleanup failed:', error);
    }
  }

  /**
   * Get storage statistics
   */
  static getStorageStats(): {
    used: number;
    max: number;
    percentage: number;
    isWarning: boolean;
    items: { key: string; size: number }[];
  } {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        used: 0,
        max: this.MAX_SIZE_BYTES,
        percentage: 0,
        isWarning: false,
        items: []
      };
    }

    const items: { key: string; size: number }[] = [];

    try {
      // Use localStorage.length and key() method like getStorageSize()
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            const size = (key.length + value.length) * 2;
            items.push({ key, size });
          }
        }
      }
    } catch (error) {
      logger.warn('[StorageManager] Error getting storage stats:', error);
    }

    // Sort by size descending
    items.sort((a, b) => b.size - a.size);

    const used = this.getStorageSize();
    const percentage = this.getStorageUsagePercentage();

    return {
      used,
      max: this.MAX_SIZE_BYTES,
      percentage,
      isWarning: this.isApproachingQuota(),
      items
    };
  }

  /**
   * Clear all localStorage (use with caution!)
   */
  static clearAll(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      localStorage.clear();
      logger.debug('[StorageManager] All localStorage cleared');
    } catch (error) {
      logger.error('[StorageManager] Failed to clear localStorage:', error);
    }
  }
}

/**
 * Export a convenience function for monitoring storage in development
 */
export function monitorStorage(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
    return;
  }

  const stats = StorageManager.getStorageStats();

  logger.debug('[StorageManager] Storage Statistics');
  logger.debug(`Total Used: ${(stats.used / 1024).toFixed(2)} KB / ${(stats.max / 1024 / 1024).toFixed(2)} MB`);
  logger.debug(`Usage: ${stats.percentage.toFixed(1)}%`);
  logger.debug(`Warning Level: ${stats.isWarning ? 'YES' : 'No'}`);
  logger.debug('\nTop 5 Storage Items:');
  stats.items.slice(0, 5).forEach(item => {
    logger.debug(`  ${item.key}: ${(item.size / 1024).toFixed(2)} KB`);
  });
}