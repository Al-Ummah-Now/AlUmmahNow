import { logger } from '@/lib/logger-server';

/**
 * localStorage Quota Management System
 *
 * Prevents QuotaExceededError by:
 * 1. Checking available quota before writing
 * 2. Implementing LRU eviction strategy
 * 3. Automatic cleanup of old data
 * 4. Size estimation and limits
 * 5. Graceful degradation
 */

export interface StorageItem {
  data: string;
  timestamp: number;
  lastAccessed: number;
  size: number;
}

export interface QuotaInfo {
  available: boolean;
  totalSize: number;
  estimatedUsage: number;
  itemCount: number;
}

export interface StorageResult {
  success: boolean;
  error?: 'QUOTA_EXCEEDED' | 'STORAGE_ERROR' | 'SIZE_LIMIT_EXCEEDED';
  message?: string;
}

// Configuration constants
const MAX_ITEM_SIZE = 100 * 1024; // 100KB per item
const MAX_ITEMS_PER_USER = 100; // Max 100 experiments per user
const CLEANUP_AGE_DAYS = 90; // Remove items older than 90 days
const ESTIMATED_QUOTA_LIMIT = 5 * 1024 * 1024; // 5MB typical browser limit
const RESERVED_SPACE = 512 * 1024; // Reserve 512KB for other app data

export class LocalStorageQuotaManager {
  private static instance: LocalStorageQuotaManager;

  private constructor() {}

  static getInstance(): LocalStorageQuotaManager {
    if (!LocalStorageQuotaManager.instance) {
      LocalStorageQuotaManager.instance = new LocalStorageQuotaManager();
    }
    return LocalStorageQuotaManager.instance;
  }

  /**
   * Estimate the size of a string in bytes
   */
  private estimateSize(str: string): number {
    // Each character is typically 2 bytes in UTF-16
    return str.length * 2;
  }

  /**
   * Calculate total localStorage usage
   */
  private calculateTotalUsage(): number {
    if (typeof window === 'undefined') return 0;

    let totalSize = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            totalSize += this.estimateSize(key) + this.estimateSize(value);
          }
        }
      }
    } catch (error) {
      logger.error('Error calculating localStorage usage:', error);
    }
    return totalSize;
  }

  /**
   * Check if there's enough quota available
   */
  checkQuota(additionalSize: number = 0): QuotaInfo {
    if (typeof window === 'undefined') {
      return {
        available: false,
        totalSize: 0,
        estimatedUsage: 0,
        itemCount: 0
      };
    }

    const currentUsage = this.calculateTotalUsage();
    const estimatedUsage = currentUsage + additionalSize;
    const available = estimatedUsage < (ESTIMATED_QUOTA_LIMIT - RESERVED_SPACE);

    return {
      available,
      totalSize: ESTIMATED_QUOTA_LIMIT,
      estimatedUsage,
      itemCount: localStorage.length
    };
  }

  /**
   * Clean up old items from a specific storage key
   */
  cleanupOldItems(storageKey: string, maxAgeDays: number = CLEANUP_AGE_DAYS): number {
    if (typeof window === 'undefined') return 0;

    try {
      const data = localStorage.getItem(storageKey);
      if (!data) return 0;

      const parsed = JSON.parse(data);
      const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
      let removedCount = 0;

      // Process each user's assignments
      for (const userId in parsed) {
        const userAssignments = parsed[userId];

        for (const experimentId in userAssignments) {
          const assignment = userAssignments[experimentId];

          // Remove if older than cutoff
          if (assignment.assignmentTime && assignment.assignmentTime < cutoffTime) {
            delete userAssignments[experimentId];
            removedCount++;
          }
        }

        // Remove user entry if empty
        if (Object.keys(userAssignments).length === 0) {
          delete parsed[userId];
        }
      }

      if (removedCount > 0) {
        localStorage.setItem(storageKey, JSON.stringify(parsed));
        logger.info(`[QuotaManager] Cleaned up ${removedCount} old assignments`);
      }

      return removedCount;
    } catch (error) {
      logger.error('[QuotaManager] Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * Implement LRU eviction: remove least recently used items
   */
  private evictLRUItems(storageKey: string, targetCount: number): number {
    if (typeof window === 'undefined') return 0;

    try {
      const data = localStorage.getItem(storageKey);
      if (!data) return 0;

      const parsed = JSON.parse(data);
      const allItems: Array<{ userId: string; experimentId: string; time: number }> = [];

      // Collect all items with their access times
      for (const userId in parsed) {
        const userAssignments = parsed[userId];
        for (const experimentId in userAssignments) {
          const assignment = userAssignments[experimentId];
          allItems.push({
            userId,
            experimentId,
            time: assignment.lastAccessed || assignment.assignmentTime || 0
          });
        }
      }

      // Sort by access time (oldest first)
      allItems.sort((a, b) => a.time - b.time);

      // Remove oldest items
      let removedCount = 0;
      const itemsToRemove = Math.max(0, allItems.length - targetCount);

      for (let i = 0; i < itemsToRemove; i++) {
        const item = allItems[i];
        if (parsed[item.userId] && parsed[item.userId][item.experimentId]) {
          delete parsed[item.userId][item.experimentId];
          removedCount++;
        }
      }

      // Clean up empty user entries
      for (const userId in parsed) {
        if (Object.keys(parsed[userId]).length === 0) {
          delete parsed[userId];
        }
      }

      if (removedCount > 0) {
        localStorage.setItem(storageKey, JSON.stringify(parsed));
        logger.info(`[QuotaManager] Evicted ${removedCount} LRU items`);
      }

      return removedCount;
    } catch (error) {
      logger.error('[QuotaManager] Error during LRU eviction:', error);
      return 0;
    }
  }

  /**
   * Count total items for a specific user
   */
  private countUserItems(storageKey: string, userId: string): number {
    if (typeof window === 'undefined') return 0;

    try {
      const data = localStorage.getItem(storageKey);
      if (!data) return 0;

      const parsed = JSON.parse(data);
      return parsed[userId] ? Object.keys(parsed[userId]).length : 0;
    } catch (error) {
      logger.error('[QuotaManager] Error counting user items:', error);
      return 0;
    }
  }

  /**
   * Safely set an item in localStorage with quota management
   */
  safeSetItem(key: string, value: string, options?: {
    userId?: string;
    maxUserItems?: number;
    enableCleanup?: boolean;
  }): StorageResult {
    if (typeof window === 'undefined') {
      return {
        success: false,
        error: 'STORAGE_ERROR',
        message: 'localStorage not available'
      };
    }

    const opts = {
      maxUserItems: MAX_ITEMS_PER_USER,
      enableCleanup: true,
      ...options
    };

    try {
      // Check item size
      const itemSize = this.estimateSize(key) + this.estimateSize(value);
      if (itemSize > MAX_ITEM_SIZE) {
        logger.error(`[QuotaManager] Item size ${itemSize} exceeds limit ${MAX_ITEM_SIZE}`);
        return {
          success: false,
          error: 'SIZE_LIMIT_EXCEEDED',
          message: `Item size (${itemSize} bytes) exceeds maximum (${MAX_ITEM_SIZE} bytes)`
        };
      }

      // Check if user has too many items
      if (opts.userId) {
        const userItemCount = this.countUserItems(key, opts.userId);
        if (userItemCount >= opts.maxUserItems) {
          logger.warn(`[QuotaManager] User ${opts.userId} has ${userItemCount} items, performing LRU eviction`);
          this.evictLRUItems(key, Math.floor(opts.maxUserItems * 0.8)); // Keep 80% of max
        }
      }

      // Check quota
      const quotaInfo = this.checkQuota(itemSize);
      if (!quotaInfo.available) {
        logger.warn(`[QuotaManager] Quota check failed, current usage: ${quotaInfo.estimatedUsage} bytes`);

        // Attempt cleanup before failing
        if (opts.enableCleanup) {
          const cleanedCount = this.cleanupOldItems(key);
          if (cleanedCount > 0) {
            // Retry after cleanup
            const retryQuotaInfo = this.checkQuota(itemSize);
            if (!retryQuotaInfo.available) {
              // Still not enough space, try LRU eviction
              this.evictLRUItems(key, Math.floor(MAX_ITEMS_PER_USER * 0.5)); // Keep 50% of max
            }
          }
        }
      }

      // Attempt to set the item
      localStorage.setItem(key, value);

      return { success: true };

    } catch (error) {
      // Handle QuotaExceededError specifically
      if (error instanceof DOMException &&
          (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {

        logger.error('[QuotaManager] QuotaExceededError caught, attempting recovery');

        // Emergency cleanup
        if (opts.enableCleanup) {
          this.cleanupOldItems(key, 30); // More aggressive: remove items older than 30 days
          this.evictLRUItems(key, Math.floor(MAX_ITEMS_PER_USER * 0.3)); // Keep only 30% of max

          // Final retry
          try {
            localStorage.setItem(key, value);
            logger.info('[QuotaManager] Recovery successful after emergency cleanup');
            return { success: true };
          } catch (retryError) {
            logger.error('[QuotaManager] Recovery failed:', retryError);
          }
        }

        return {
          success: false,
          error: 'QUOTA_EXCEEDED',
          message: 'localStorage quota exceeded and recovery failed'
        };
      }

      // Other storage errors
      logger.error('[QuotaManager] Storage error:', error);
      return {
        success: false,
        error: 'STORAGE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown storage error'
      };
    }
  }

  /**
   * Safely get an item from localStorage
   */
  safeGetItem(key: string): string | null {
    if (typeof window === 'undefined') return null;

    try {
      return localStorage.getItem(key);
    } catch (error) {
      logger.error('[QuotaManager] Error getting item:', error);
      return null;
    }
  }

  /**
   * Safely remove an item from localStorage
   */
  safeRemoveItem(key: string): boolean {
    if (typeof window === 'undefined') return false;

    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      logger.error('[QuotaManager] Error removing item:', error);
      return false;
    }
  }

  /**
   * Update last accessed time for an item (for LRU tracking)
   */
  updateLastAccessed(storageKey: string, userId: string, experimentId: string): void {
    if (typeof window === 'undefined') return;

    try {
      const data = localStorage.getItem(storageKey);
      if (!data) return;

      const parsed = JSON.parse(data);
      if (parsed[userId] && parsed[userId][experimentId]) {
        parsed[userId][experimentId].lastAccessed = Date.now();
        localStorage.setItem(storageKey, JSON.stringify(parsed));
      }
    } catch (error) {
      logger.error('[QuotaManager] Error updating last accessed time:', error);
    }
  }

  /**
   * Get storage statistics
   */
  getStorageStats(): {
    totalSize: number;
    itemCount: number;
    percentUsed: number;
    available: boolean;
  } {
    const quotaInfo = this.checkQuota();
    const percentUsed = (quotaInfo.estimatedUsage / quotaInfo.totalSize) * 100;

    return {
      totalSize: quotaInfo.totalSize,
      itemCount: quotaInfo.itemCount,
      percentUsed: Math.round(percentUsed * 100) / 100,
      available: quotaInfo.available
    };
  }

  /**
   * Perform maintenance: cleanup old items and check quota
   */
  performMaintenance(storageKey: string): {
    cleanedItems: number;
    quotaAvailable: boolean;
  } {
    const cleanedItems = this.cleanupOldItems(storageKey);
    const quotaInfo = this.checkQuota();

    return {
      cleanedItems,
      quotaAvailable: quotaInfo.available
    };
  }
}

export const quotaManager = LocalStorageQuotaManager.getInstance();
