/**
 * Tests for StorageManager utility
 *
 * Tests quota management, cleanup, and safe storage operations
 */

import { StorageManager, monitorStorage } from '../storage';

// Mock localStorage for testing
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  const maxSize = 100 * 1024; // 100KB for testing (much smaller than real)

  const mock = {
    getItem: (key: string): string | null => {
      return store[key] || null;
    },
    setItem: (key: string, value: string): void => {
      // Simulate quota check
      const currentSize = Object.keys(store).reduce((acc, k) => {
        return acc + k.length + store[k].length;
      }, 0) * 2;

      const newSize = (key.length + value.length) * 2;

      if (currentSize + newSize > maxSize) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }

      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key: (index: number): string | null => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
    hasOwnProperty: (key: string): boolean => {
      return store.hasOwnProperty(key);
    }
  };

  // Make functions non-enumerable so Object.keys() doesn't return them
  Object.defineProperty(mock, 'getItem', { enumerable: false });
  Object.defineProperty(mock, 'setItem', { enumerable: false });
  Object.defineProperty(mock, 'removeItem', { enumerable: false });
  Object.defineProperty(mock, 'clear', { enumerable: false });
  Object.defineProperty(mock, 'length', { enumerable: false });
  Object.defineProperty(mock, 'key', { enumerable: false });
  Object.defineProperty(mock, 'hasOwnProperty', { enumerable: false });

  return mock;
})();

// Replace global localStorage with mock
if (typeof global !== 'undefined') {
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
  
  // Also add window object for browser environment simulation
  Object.defineProperty(global, 'window', {
    value: {
      localStorage: localStorageMock,
    },
    writable: true,
  });
}

describe('StorageManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getStorageSize', () => {
    it('should calculate the correct storage size', () => {
      localStorage.setItem('test1', 'hello');
      localStorage.setItem('test2', 'world');

      const size = StorageManager.getStorageSize();

      // Size = ('test1' + 'hello' + 'test2' + 'world') * 2 (UTF-16)
      // = (5 + 5 + 5 + 5) * 2 = 40 bytes
      expect(size).toBe(40);
    });

    it('should return 0 when localStorage is empty', () => {
      const size = StorageManager.getStorageSize();
      expect(size).toBe(0);
    });
  });

  describe('canStore', () => {
    it('should return true when there is enough space', () => {
      const canStore = StorageManager.canStore('key', 'value');
      expect(canStore).toBe(true);
    });

    it('should return false when quota would be exceeded', () => {
      // Fill storage near capacity using StorageManager's actual limit (4MB)
      const storageManagerMaxSize = 4 * 1024 * 1024; // 4MB
      const largeData = 'x'.repeat(storageManagerMaxSize / 2); // 2MB of data
      
      // This should work in mock since it has 100KB limit but StorageManager thinks it's 4MB
      try {
        localStorage.setItem('large', largeData);
      } catch (_error) {
        // If mock fails, use smaller data that fits in mock
        const smallerData = 'x'.repeat(40000); // 80KB of data
        localStorage.setItem('large', smallerData);
      }

      // Now check if adding more would exceed StorageManager's 4MB limit
      const canStore = StorageManager.canStore('another', largeData);
      expect(canStore).toBe(false);
    });
  });

  describe('cleanupOldData', () => {
    it('should remove old items based on timestamp', () => {
      const now = Date.now();
      const oldTimestamp = now - (31 * 24 * 60 * 60 * 1000); // 31 days ago
      const recentTimestamp = now - (1 * 24 * 60 * 60 * 1000); // 1 day ago

      const watchProgress = {
        'video1': { timestamp: new Date(oldTimestamp).toISOString(), currentTime: 100 },
        'video2': { timestamp: new Date(recentTimestamp).toISOString(), currentTime: 200 },
      };

      localStorage.setItem('watchProgress', JSON.stringify(watchProgress));

      // Clean data older than 30 days
      const itemsRemoved = StorageManager.cleanupOldData(['watchProgress'], 30 * 24 * 60 * 60 * 1000);

      const stored = localStorage.getItem('watchProgress');
      const parsed = stored ? JSON.parse(stored) : {};

      expect(itemsRemoved).toBe(1);
      expect(parsed['video1']).toBeUndefined();
      expect(parsed['video2']).toBeDefined();
    });

    it('should handle different timestamp formats', () => {
      const now = Date.now();
      const oldTimestamp = now - (31 * 24 * 60 * 60 * 1000);

      const data = {
        'item1': { timestamp: oldTimestamp }, // number format
        'item2': { timestamp: new Date(oldTimestamp).toISOString() }, // string format
        'item3': { expiresAt: oldTimestamp }, // alternative field name
      };

      localStorage.setItem('testData', JSON.stringify(data));

      const itemsRemoved = StorageManager.cleanupOldData(['testData'], 30 * 24 * 60 * 60 * 1000);

      const stored = localStorage.getItem('testData');

      // All old items should be removed
      expect(itemsRemoved).toBe(3);
      expect(stored).toBeNull(); // Key removed when empty
    });
  });

  describe('safeSetItem', () => {
    it('should store item successfully when space is available', () => {
      const success = StorageManager.safeSetItem('test', 'value');
      expect(success).toBe(true);
      expect(localStorage.getItem('test')).toBe('value');
    });

    it('should handle QuotaExceededError gracefully', () => {
      // Fill storage to capacity
      const largeData = 'x'.repeat(45000); // Almost fill the 100KB test limit
      localStorage.setItem('large', largeData);

      // Mock console methods to test logging
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Try to store more data (should trigger cleanup)
      StorageManager.safeSetItem('overflow', largeData);

      // Should log warning about quota
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should attempt cleanup when approaching quota', () => {
      // Add old data that can be cleaned
      const now = Date.now();
      const oldData = {
        'old1': { timestamp: now - (35 * 24 * 60 * 60 * 1000) }, // 35 days old
      };
      localStorage.setItem('watchProgress', JSON.stringify(oldData));

      // Fill storage near capacity
      const largeData = 'x'.repeat(40000);
      localStorage.setItem('large', largeData);

      // Should trigger cleanup and succeed
      const success = StorageManager.safeSetItem('new', 'data');
      expect(success).toBe(true);
    });
  });

  describe('getStorageStats', () => {
    it('should return accurate storage statistics', () => {
      localStorage.setItem('key1', 'value1');
      localStorage.setItem('key2', 'value2');

      const stats = StorageManager.getStorageStats();

      expect(stats.used).toBeGreaterThan(0);
      expect(stats.max).toBe(4 * 1024 * 1024); // 4MB
      expect(stats.percentage).toBeGreaterThanOrEqual(0);
      expect(stats.percentage).toBeLessThanOrEqual(100);
      expect(stats.items).toHaveLength(2);
      expect(stats.items[0].key).toBeDefined();
      expect(stats.items[0].size).toBeGreaterThan(0);
    });

    it('should sort items by size in descending order', () => {
      localStorage.setItem('small', 'x');
      localStorage.setItem('large', 'x'.repeat(100));

      const stats = StorageManager.getStorageStats();

      expect(stats.items[0].key).toBe('large');
      expect(stats.items[1].key).toBe('small');
      expect(stats.items[0].size).toBeGreaterThan(stats.items[1].size);
    });
  });

  describe('emergency cleanup', () => {
    it('should keep only most recent watch progress', () => {
      const now = Date.now();
      const watchProgress: Record<string, unknown> = {};

      // Create 20 watch progress entries
      for (let i = 0; i < 20; i++) {
        watchProgress[`video${i}`] = {
          timestamp: new Date(now - (i * 60 * 60 * 1000)).toISOString(), // Each 1 hour older
          currentTime: i * 100
        };
      }

      localStorage.setItem('watchProgress', JSON.stringify(watchProgress));

      // Trigger emergency cleanup indirectly
      // This would normally happen when quota is exceeded
      // For testing, we'll call it via a failed safeSetItem with mocked quota error

      const originalSetItem = localStorage.setItem;
      let callCount = 0;

      // Mock setItem to throw QuotaExceededError on first call
      localStorage.setItem = jest.fn((key: string, value: string) => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return originalSetItem.call(localStorage, key, value);
      });

      StorageManager.safeSetItem('trigger', 'emergency');

      // Restore original
      localStorage.setItem = originalSetItem;

      const stored = localStorage.getItem('watchProgress');
      if (stored) {
        const parsed = JSON.parse(stored);
        const entries = Object.keys(parsed);

        // Should keep only 10 most recent
        expect(entries.length).toBeLessThanOrEqual(10);

        // Verify they are the most recent ones (video0 - video9)
        entries.forEach(key => {
          const videoNumber = parseInt(key.replace('video', ''));
          expect(videoNumber).toBeLessThan(10);
        });
      }
    });
  });

  describe('integration with watch history', () => {
    it('should handle watch progress with automatic cleanup', () => {
      const now = Date.now();

      // Simulate accumulated watch progress over time
      const watchProgress: Record<string, unknown> = {};

      // Add 50 old entries (> 30 days)
      for (let i = 0; i < 50; i++) {
        watchProgress[`old-video-${i}`] = {
          videoId: `old-video-${i}`,
          timestamp: new Date(now - (35 * 24 * 60 * 60 * 1000)).toISOString(),
          currentTime: 100,
          duration: 1000,
          completed: false
        };
      }

      // Add 5 recent entries
      for (let i = 0; i < 5; i++) {
        watchProgress[`recent-video-${i}`] = {
          videoId: `recent-video-${i}`,
          timestamp: new Date(now - (i * 60 * 60 * 1000)).toISOString(),
          currentTime: 500,
          duration: 1000,
          completed: false
        };
      }

      localStorage.setItem('watchProgress', JSON.stringify(watchProgress));

      // Clean old data
      const removed = StorageManager.cleanupOldData(['watchProgress']);

      const stored = localStorage.getItem('watchProgress');
      const parsed = stored ? JSON.parse(stored) : {};

      // Should have removed 50 old entries
      expect(removed).toBe(50);

      // Should keep only 5 recent entries
      expect(Object.keys(parsed)).toHaveLength(5);

      // All remaining should be recent videos
      Object.keys(parsed).forEach(key => {
        expect(key).toMatch(/^recent-video-/);
      });
    });
  });

  describe('integration with engagement service', () => {
    it('should handle view tracking with session expiry', () => {
      const now = Date.now();

      // Simulate view tracking data
      const viewData: Record<string, number> = {};

      // Add old views (expired session)
      for (let i = 0; i < 20; i++) {
        viewData[`old-video-${i}`] = now - (2 * 60 * 60 * 1000); // 2 hours old
      }

      // Add recent views (current session)
      for (let i = 0; i < 10; i++) {
        viewData[`current-video-${i}`] = now - (10 * 60 * 1000); // 10 minutes old
      }

      const success = StorageManager.safeSetItem(
        'video_views_tracked',
        JSON.stringify(viewData)
      );

      expect(success).toBe(true);

      const stored = localStorage.getItem('video_views_tracked');
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(Object.keys(parsed)).toHaveLength(30);
    });
  });
});

describe('Storage Monitoring', () => {
  it('should provide helpful monitoring in development', () => {
    // Set NODE_ENV to development
    const originalEnv = process.env.NODE_ENV;
    (process.env as unknown).NODE_ENV = 'development';

    // Mock console.group methods
    const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation();
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation();

    // Add some test data
    localStorage.setItem('test1', 'x'.repeat(100));
    localStorage.setItem('test2', 'x'.repeat(200));

    // Call monitorStorage (already imported at top)
    monitorStorage();

    // Should have called console methods
    expect(consoleGroupSpy).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalled();
    expect(consoleGroupEndSpy).toHaveBeenCalled();

    // Restore
    consoleGroupSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleGroupEndSpy.mockRestore();
    (process.env as unknown).NODE_ENV = originalEnv;
  });
});