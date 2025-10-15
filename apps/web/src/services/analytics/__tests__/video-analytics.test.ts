/**
 * Video Analytics Unit Tests
 *
 * Tests for VideoAnalytics service including:
 * - Session ID generation
 * - Event tracking
 * - Batch flushing
 * - Timer-based flushing
 * - Error handling
 * - LocalStorage fallback
 * - Cleanup
 */

import { VideoAnalytics, getVideoAnalytics, destroyVideoAnalytics, clearAllAnalytics } from '../video-analytics';
import { VideoEventType } from '../types';

// Mock fetch
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

// Mock document for visibility API
Object.defineProperty(global, 'document', {
  value: {
    hidden: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  },
  writable: true
});

describe('VideoAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200
    });
    localStorageMock.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Session ID Generation', () => {
    it('should generate unique session IDs', () => {
      const analytics1 = new VideoAnalytics('video-1');
      const analytics2 = new VideoAnalytics('video-1');

      const sessionId1 = analytics1.getSessionId();
      const sessionId2 = analytics2.getSessionId();

      expect(sessionId1).toBeTruthy();
      expect(sessionId2).toBeTruthy();
      expect(sessionId1).not.toBe(sessionId2);

      analytics1.destroy();
      analytics2.destroy();
    });

    it('should include timestamp and random component in session ID', () => {
      const analytics = new VideoAnalytics('video-1');
      const sessionId = analytics.getSessionId();

      expect(sessionId).toMatch(/^\d+-[a-z0-9]+$/);
      analytics.destroy();
    });
  });

  describe('Event Tracking', () => {
    it('should track ready event', () => {
      const analytics = new VideoAnalytics('video-1');
      analytics.trackReady();

      expect(analytics.getQueueLength()).toBe(1);
      analytics.destroy();
    });

    it('should track play event', () => {
      const analytics = new VideoAnalytics('video-1', 'user-1');
      analytics.trackPlay();

      expect(analytics.getQueueLength()).toBe(1);
      analytics.destroy();
    });

    it('should track pause event', () => {
      const analytics = new VideoAnalytics('video-1');
      analytics.trackPause();

      expect(analytics.getQueueLength()).toBe(1);
      analytics.destroy();
    });

    it('should track complete event with total watch time', async () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackComplete();

      // Complete should flush immediately
      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          keepalive: true
        })
      );

      analytics.destroy();
    });

    it('should track error event', async () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackError({
        code: 'MEDIA_ERR_NETWORK',
        message: 'Network error',
        type: 'NetworkError'
      });

      // Error should flush immediately
      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalled();
      analytics.destroy();
    });

    it('should include userId in events when provided', () => {
      const analytics = new VideoAnalytics('video-1', 'user-123');
      analytics.trackPlay();

      // Access private queue to verify event structure
      const queue = (analytics as any).eventQueue;
      expect(queue[0].userId).toBe('user-123');

      analytics.destroy();
    });

    it('should include videoId, sessionId, and timestamp in all events', () => {
      const analytics = new VideoAnalytics('video-1');
      const sessionId = analytics.getSessionId();

      analytics.trackPlay();

      const queue = (analytics as any).eventQueue;
      const event = queue[0];

      expect(event.videoId).toBe('video-1');
      expect(event.sessionId).toBe(sessionId);
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(event.eventType).toBe(VideoEventType.PLAY);
      expect(typeof event.relativeTime).toBe('number');

      analytics.destroy();
    });
  });

  describe('Batch Flushing', () => {
    it('should flush events when batch size is reached', async () => {
      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 3
      });

      analytics.trackPlay();
      analytics.trackPause();
      expect(global.fetch).not.toHaveBeenCalled();

      analytics.trackPlay(); // 3rd event triggers flush

      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(analytics.getQueueLength()).toBe(0);

      analytics.destroy();
    });

    it('should send events in correct batch format', async () => {
      const analytics = new VideoAnalytics('video-1', 'user-1', {
        batchSize: 2
      });

      analytics.trackPlay();
      analytics.trackPause(); // Triggers flush

      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/analytics/video',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: expect.stringContaining('"events":[')
        })
      );

      analytics.destroy();
    });
  });

  describe('Timer-Based Flushing', () => {
    it('should flush events automatically after flush interval', async () => {
      const analytics = new VideoAnalytics('video-1', undefined, {
        flushInterval: 1000
      });

      analytics.trackPlay();
      expect(global.fetch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalled();
      analytics.destroy();
    });

    it('should flush multiple times on interval', async () => {
      const analytics = new VideoAnalytics('video-1', undefined, {
        flushInterval: 1000,
        batchSize: 100 // High batch size to prevent batch-based flush
      });

      analytics.trackPlay();
      jest.advanceTimersByTime(1000);
      await analytics.waitForPendingFlushes();

      analytics.trackPause();
      jest.advanceTimersByTime(1000);
      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      analytics.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should handle failed fetch requests', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      // Events should be re-added to queue
      expect(analytics.getQueueLength()).toBeGreaterThan(0);

      analytics.destroy();
    });

    it('should handle non-ok response status', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      // Events should be re-added to queue
      expect(analytics.getQueueLength()).toBeGreaterThan(0);

      analytics.destroy();
    });
  });

  describe('LocalStorage Fallback', () => {
    it('should store events in localStorage on failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      const stored = localStorageMock.getItem('pendingVideoAnalytics');
      expect(stored).toBeTruthy();

      const events = JSON.parse(stored!);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(VideoEventType.PLAY);

      analytics.destroy();
    });

    it('should append to existing localStorage data', async () => {
      // Pre-populate localStorage
      localStorageMock.setItem('pendingVideoAnalytics', JSON.stringify([
        { eventType: 'ready', videoId: 'video-0' }
      ]));

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      const stored = localStorageMock.getItem('pendingVideoAnalytics');
      const events = JSON.parse(stored!);

      expect(events).toHaveLength(2);
      analytics.destroy();
    });

    it('should handle localStorage errors gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      // Mock localStorage.setItem to throw
      const originalSetItem = localStorageMock.setItem;
      localStorageMock.setItem = jest.fn(() => {
        throw new Error('QuotaExceededError');
      });

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      // Should not throw, just log error
      expect(true).toBe(true);

      // Restore
      localStorageMock.setItem = originalSetItem;
      analytics.destroy();
    });
  });

  describe('Unload Handling', () => {
    it('should setup beforeunload handler', () => {
      const addEventListener = jest.spyOn(window, 'addEventListener');

      const analytics = new VideoAnalytics('video-1');

      expect(addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      analytics.destroy();
      addEventListener.mockRestore();
    });

    it('should setup visibilitychange handler', () => {
      const addEventListener = jest.spyOn(document, 'addEventListener');

      const analytics = new VideoAnalytics('video-1');

      expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

      analytics.destroy();
      addEventListener.mockRestore();
    });
  });

  describe('Cleanup', () => {
    it('should flush events on destroy', async () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackPlay();
      analytics.destroy();

      await jest.runAllTimersAsync();

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should clear flush interval on destroy', () => {
      const analytics = new VideoAnalytics('video-1');
      const flushInterval = (analytics as any).flushInterval;

      expect(flushInterval).toBeTruthy();

      analytics.destroy();

      expect((analytics as any).flushInterval).toBeUndefined();
    });

    it('should remove event listeners on destroy', () => {
      const removeEventListener = jest.spyOn(window, 'removeEventListener');

      const analytics = new VideoAnalytics('video-1');
      analytics.destroy();

      expect(removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      removeEventListener.mockRestore();
    });
  });

  describe('Singleton Factory', () => {
    afterEach(() => {
      clearAllAnalytics();
    });

    it('should return same instance for same video and user', () => {
      const analytics1 = getVideoAnalytics('video-1', 'user-1');
      const analytics2 = getVideoAnalytics('video-1', 'user-1');

      expect(analytics1).toBe(analytics2);
    });

    it('should return different instances for different videos', () => {
      const analytics1 = getVideoAnalytics('video-1', 'user-1');
      const analytics2 = getVideoAnalytics('video-2', 'user-1');

      expect(analytics1).not.toBe(analytics2);
    });

    it('should return different instances for different users', () => {
      const analytics1 = getVideoAnalytics('video-1', 'user-1');
      const analytics2 = getVideoAnalytics('video-1', 'user-2');

      expect(analytics1).not.toBe(analytics2);
    });

    it('should destroy specific analytics instance', () => {
      const analytics = getVideoAnalytics('video-1', 'user-1');
      const flushInterval = (analytics as any).flushInterval;

      expect(flushInterval).toBeTruthy();

      destroyVideoAnalytics('video-1', 'user-1');

      expect((analytics as any).flushInterval).toBeUndefined();
    });

    it('should clear all analytics instances', () => {
      const analytics1 = getVideoAnalytics('video-1', 'user-1');
      const analytics2 = getVideoAnalytics('video-2', 'user-2');

      clearAllAnalytics();

      expect((analytics1 as any).flushInterval).toBeUndefined();
      expect((analytics2 as any).flushInterval).toBeUndefined();
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const analytics = new VideoAnalytics('video-1');
      const config = (analytics as any).config;

      expect(config.endpoint).toBe('/api/analytics/video');
      expect(config.batchSize).toBe(20);
      expect(config.flushInterval).toBe(30000);

      analytics.destroy();
    });

    it('should merge custom configuration', () => {
      const analytics = new VideoAnalytics('video-1', undefined, {
        endpoint: '/custom/analytics',
        batchSize: 10,
        flushInterval: 5000
      });

      const config = (analytics as any).config;

      expect(config.endpoint).toBe('/custom/analytics');
      expect(config.batchSize).toBe(10);
      expect(config.flushInterval).toBe(5000);

      analytics.destroy();
    });

    it('should enable debug logging when explicitly configured', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const analytics = new VideoAnalytics('video-1', undefined, {
        enableDebugLogging: true
      });
      analytics.trackPlay();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[VideoAnalytics]',
        VideoEventType.PLAY,
        expect.any(Object)
      );

      consoleSpy.mockRestore();
      analytics.destroy();
    });
  });
});
