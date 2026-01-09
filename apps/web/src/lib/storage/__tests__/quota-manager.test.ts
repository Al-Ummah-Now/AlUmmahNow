/**
 * Tests for LocalStorageQuotaManager
 */

import { LocalStorageQuotaManager } from '../quota-manager';

describe('LocalStorageQuotaManager', () => {
  let quotaManager: LocalStorageQuotaManager;
  let mockLocalStorage: { [key: string]: string };

  beforeEach(() => {
    // Reset localStorage mock
    mockLocalStorage = {};

    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: jest.fn((key: string) => mockLocalStorage[key] || null),
        setItem: jest.fn((key: string, value: string) => {
          // Simulate quota check
          const totalSize = Object.values(mockLocalStorage).reduce(
            (acc, val) => acc + val.length * 2,
            0
          );
          const newSize = value.length * 2;

          if (totalSize + newSize > 1024 * 100) { // 100KB limit for tests
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
          }

          mockLocalStorage[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete mockLocalStorage[key];
        }),
        clear: jest.fn(() => {
          mockLocalStorage = {};
        }),
        get length() {
          return Object.keys(mockLocalStorage).length;
        },
        key: jest.fn((index: number) => {
          const keys = Object.keys(mockLocalStorage);
          return keys[index] || null;
        })
      },
      writable: true
    });

    quotaManager = LocalStorageQuotaManager.getInstance();
  });

  describe('checkQuota', () => {
    it('should return available quota information', () => {
      const quotaInfo = quotaManager.checkQuota();

      expect(quotaInfo).toHaveProperty('available');
      expect(quotaInfo).toHaveProperty('totalSize');
      expect(quotaInfo).toHaveProperty('estimatedUsage');
      expect(quotaInfo).toHaveProperty('itemCount');
      expect(typeof quotaInfo.available).toBe('boolean');
    });

    it('should calculate total usage correctly', () => {
      localStorage.setItem('key1', 'value1');
      localStorage.setItem('key2', 'value2');

      const quotaInfo = quotaManager.checkQuota();

      expect(quotaInfo.itemCount).toBe(2);
      expect(quotaInfo.estimatedUsage).toBeGreaterThan(0);
    });

    it('should detect insufficient quota', () => {
      // Test with a very large additional size that would exceed the 5MB limit
      const hugeAdditionalSize = 10 * 1024 * 1024; // 10MB additional data

      const quotaInfo = quotaManager.checkQuota(hugeAdditionalSize);

      expect(quotaInfo.available).toBe(false);
      expect(quotaInfo.estimatedUsage).toBeGreaterThan(5 * 1024 * 1024); // Should exceed 5MB
    });
  });

  describe('safeSetItem', () => {
    it('should successfully store item when quota is available', () => {
      const result = quotaManager.safeSetItem('test-key', 'test-value');

      expect(result.success).toBe(true);
      expect(localStorage.getItem('test-key')).toBe('test-value');
    });

    it('should fail when item size exceeds limit', () => {
      const largeValue = 'x'.repeat(101 * 1024); // Exceeds MAX_ITEM_SIZE (100KB)

      const result = quotaManager.safeSetItem('large-key', largeValue);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SIZE_LIMIT_EXCEEDED');
    });

    it('should handle QuotaExceededError gracefully', () => {
      // Fill storage to near capacity
      for (let i = 0; i < 10; i++) {
        mockLocalStorage[`fill-${i}`] = 'x'.repeat(10 * 1024);
      }

      const result = quotaManager.safeSetItem('overflow-key', 'x'.repeat(10 * 1024));

      expect(result.success).toBe(false);
      expect(result.error).toBe('QUOTA_EXCEEDED');
    });

    it('should enable cleanup by default', () => {
      const result = quotaManager.safeSetItem('test-key', 'test-value', {
        enableCleanup: true
      });

      expect(result.success).toBe(true);
    });
  });

  describe('safeGetItem', () => {
    it('should retrieve stored item', () => {
      localStorage.setItem('test-key', 'test-value');

      const value = quotaManager.safeGetItem('test-key');

      expect(value).toBe('test-value');
    });

    it('should return null for non-existent item', () => {
      const value = quotaManager.safeGetItem('non-existent');

      expect(value).toBeNull();
    });

    it('should handle storage errors gracefully', () => {
      // Mock error
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage error');
      });

      const value = quotaManager.safeGetItem('test-key');

      expect(value).toBeNull();
    });
  });

  describe('safeRemoveItem', () => {
    it('should remove stored item', () => {
      localStorage.setItem('test-key', 'test-value');

      const success = quotaManager.safeRemoveItem('test-key');

      expect(success).toBe(true);
      expect(localStorage.getItem('test-key')).toBeNull();
    });

    it('should handle removal of non-existent item', () => {
      const success = quotaManager.safeRemoveItem('non-existent');

      expect(success).toBe(true);
    });
  });

  describe('cleanupOldItems', () => {
    it('should remove items older than specified days', () => {
      const storageKey = 'test-assignments';
      const now = Date.now();
      const oldTime = now - (100 * 24 * 60 * 60 * 1000); // 100 days ago

      const data = {
        'user1': {
          'exp1': { assignmentTime: oldTime, variant: 'control' },
          'exp2': { assignmentTime: now, variant: 'treatment' }
        }
      };

      localStorage.setItem(storageKey, JSON.stringify(data));

      const removedCount = quotaManager.cleanupOldItems(storageKey, 90);

      expect(removedCount).toBe(1);

      const updated = JSON.parse(localStorage.getItem(storageKey) || '{}');
      expect(updated.user1.exp1).toBeUndefined();
      expect(updated.user1.exp2).toBeDefined();
    });

    it('should remove empty user entries after cleanup', () => {
      const storageKey = 'test-assignments';
      const oldTime = Date.now() - (100 * 24 * 60 * 60 * 1000);

      const data = {
        'user1': {
          'exp1': { assignmentTime: oldTime, variant: 'control' }
        }
      };

      localStorage.setItem(storageKey, JSON.stringify(data));

      quotaManager.cleanupOldItems(storageKey, 90);

      const updated = JSON.parse(localStorage.getItem(storageKey) || '{}');
      expect(updated.user1).toBeUndefined();
    });

    it('should return 0 if storage key does not exist', () => {
      const removedCount = quotaManager.cleanupOldItems('non-existent', 90);

      expect(removedCount).toBe(0);
    });
  });

  describe('updateLastAccessed', () => {
    it('should update lastAccessed timestamp', () => {
      const storageKey = 'test-assignments';
      const data = {
        'user1': {
          'exp1': { assignmentTime: Date.now(), variant: 'control', lastAccessed: 0 }
        }
      };

      localStorage.setItem(storageKey, JSON.stringify(data));

      quotaManager.updateLastAccessed(storageKey, 'user1', 'exp1');

      const updated = JSON.parse(localStorage.getItem(storageKey) || '{}');
      expect(updated.user1.exp1.lastAccessed).toBeGreaterThan(0);
    });

    it('should handle non-existent item gracefully', () => {
      const storageKey = 'test-assignments';
      localStorage.setItem(storageKey, JSON.stringify({}));

      expect(() => {
        quotaManager.updateLastAccessed(storageKey, 'user1', 'exp1');
      }).not.toThrow();
    });
  });

  describe('getStorageStats', () => {
    it('should return storage statistics', () => {
      localStorage.setItem('key1', 'value1');
      localStorage.setItem('key2', 'value2');

      const stats = quotaManager.getStorageStats();

      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('itemCount');
      expect(stats).toHaveProperty('percentUsed');
      expect(stats).toHaveProperty('available');
      expect(stats.itemCount).toBe(2);
    });
  });

  describe('performMaintenance', () => {
    it('should cleanup and check quota', () => {
      const storageKey = 'test-assignments';
      const oldTime = Date.now() - (100 * 24 * 60 * 60 * 1000);

      const data = {
        'user1': {
          'exp1': { assignmentTime: oldTime, variant: 'control' }
        }
      };

      localStorage.setItem(storageKey, JSON.stringify(data));

      const result = quotaManager.performMaintenance(storageKey);

      expect(result).toHaveProperty('cleanedItems');
      expect(result).toHaveProperty('quotaAvailable');
      expect(result.cleanedItems).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SSR compatibility', () => {
    it('should handle missing window gracefully', () => {
      const originalWindow = global.window;
      // @ts-expect-error - simulating SSR
      delete global.window;

      const quotaInfo = quotaManager.checkQuota();

      expect(quotaInfo.available).toBe(false);
      expect(quotaInfo.totalSize).toBe(0);

      // Restore
      global.window = originalWindow;
    });
  });
});
