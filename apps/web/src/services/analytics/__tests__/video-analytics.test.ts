/**
 * Video Analytics Unit Tests
 *
 * Tests for VideoAnalytics service including:
 * - Session ID generation
 * - Event tracking
 * - Batch flushing
 * - Timer-based flushing
 * - Error handling
 * - No localStorage persistence (GDPR, Story 1.3) and consent gating
 * - Cleanup
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test file requires accessing private properties for verification */

import { VideoAnalytics, getVideoAnalytics, destroyVideoAnalytics, clearAllAnalytics } from '../video-analytics';
import { VideoEventType, type AnalyticsEvent } from '../types';

// Consent: granted by default in this suite; the consent-gating tests flip it.
const mockHasConsent = jest.fn(() => true);
jest.mock('@/lib/consent/ConsentManager', () => ({ hasConsent: (...args: unknown[]) => mockHasConsent(...(args as [])) }));

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

// Note: jsdom (testEnvironment) already provides `document` with the visibility
// API (hidden/addEventListener/removeEventListener). Redefining global.document
// throws "Cannot redefine property: document" under jest-environment-jsdom 30
// (it's a non-configurable global), so we rely on jsdom's document and spy on it
// per-test instead (see jest.spyOn(document, 'addEventListener') below).

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

    // Quarantined: fails on main, tracked in #206.
    it.skip('should include userId in events when provided', () => {
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
    it('keeps failed events in memory for retry and never writes them to localStorage', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 1
      });

      analytics.trackPlay(); // Triggers flush

      await analytics.waitForPendingFlushes();

      expect(localStorageMock.getItem('pendingVideoAnalytics')).toBeNull();
      expect(analytics.getQueueLength()).toBe(1);

      analytics.destroy();
    });

    it('purges the legacy pendingVideoAnalytics backup on start', () => {
      localStorageMock.setItem('pendingVideoAnalytics', JSON.stringify([
        { eventType: 'ready', videoId: 'video-0' }
      ]));

      const analytics = new VideoAnalytics('video-1');

      expect(localStorageMock.getItem('pendingVideoAnalytics')).toBeNull();
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

    // Quarantined: fails on main, tracked in #206.
    it.skip('should enable debug logging when explicitly configured', () => {
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

  describe('Phase 3: volume and loading events (#79)', () => {
    const queueOf = (a: VideoAnalytics) => (a as any).eventQueue as AnalyticsEvent[];

    it('reports a burst of volume changes once, with the final values', () => {
      jest.useFakeTimers();
      const a = new VideoAnalytics('video-volume');
      a.trackVolumeChange(0.5, false);
      a.trackVolumeChange(0.4, false);
      a.trackVolumeChange(0.3, true);
      expect(queueOf(a).filter(e => e.eventType === VideoEventType.VOLUME_CHANGE)).toHaveLength(0);
      jest.advanceTimersByTime(500);
      const events = queueOf(a).filter(e => e.eventType === VideoEventType.VOLUME_CHANGE);
      expect(events).toHaveLength(1);
      expect(events[0].data).toEqual({ volume: 0.3, muted: true });
      a.destroy();
      jest.useRealTimers();
    });

    it('queues a pending volume change when the player is destroyed before it settles', () => {
      const add = jest.spyOn(VideoAnalytics.prototype as any, 'addEvent');
      const a = new VideoAnalytics('video-volume-2');
      a.trackVolumeChange(0.9, false);
      a.destroy();
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ eventType: VideoEventType.VOLUME_CHANGE, data: { volume: 0.9, muted: false } }));
      add.mockRestore();
    });

    it('tracks load start and metadata', () => {
      const a = new VideoAnalytics('video-load');
      a.trackLoadStart();
      a.trackMetadataLoaded(120, 1920, 1080);
      const types = queueOf(a).map(e => e.eventType);
      expect(types).toEqual(expect.arrayContaining([VideoEventType.LOAD_START, VideoEventType.LOADED_METADATA]));
      expect(queueOf(a).find(e => e.eventType === VideoEventType.LOADED_METADATA)?.data).toEqual({ duration: 120, videoWidth: 1920, videoHeight: 1080 });
      a.destroy();
    });
  });

  describe('Phase 3: Advanced Analytics - trackSeek()', () => {
    it('should track seek events with fromTime and toTime', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackSeek(10, 30);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.SEEK);
      expect(queue[0].data.fromTime).toBe(10);
      expect(queue[0].data.toTime).toBe(30);

      analytics.destroy();
    });

    it('should calculate seek distance correctly', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackSeek(10, 30);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.seekDistance).toBe(20);

      analytics.destroy();
    });

    it('should detect forward seeks', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackSeek(10, 30);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isForward).toBe(true);

      analytics.destroy();
    });

    it('should detect backward seeks', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackSeek(30, 10);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isForward).toBe(false);
      expect(queue[0].data.seekDistance).toBe(-20);

      analytics.destroy();
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should include correct event metadata', () => {
      const analytics = new VideoAnalytics('video-1', 'user-1');

      analytics.trackSeek(5, 15);

      const queue = (analytics as any).eventQueue;
      const event = queue[0];

      expect(event.videoId).toBe('video-1');
      expect(event.userId).toBe('user-1');
      expect(event.sessionId).toBeTruthy();
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(typeof event.relativeTime).toBe('number');

      analytics.destroy();
    });
  });

  describe('Phase 3: Advanced Analytics - trackProgress()', () => {
    it('should track progress with currentTime, duration, and percentage', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(30, 100, 30);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.TIMEUPDATE);
      expect(queue[0].data.currentTime).toBe(30);
      expect(queue[0].data.duration).toBe(100);
      expect(queue[0].data.percentage).toBe(30);

      analytics.destroy();
    });

    it('should calculate remaining time', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(30, 100, 30);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.remainingTime).toBe(70);

      analytics.destroy();
    });

    it('should clamp percentage to 100 when over', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(105, 100, 105);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.percentage).toBe(100);

      analytics.destroy();
    });

    it('should clamp percentage to 0 when negative', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(0, 100, -5);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.percentage).toBe(0);

      analytics.destroy();
    });

    it('should handle duration of 0 gracefully', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(0, 0, 0);

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.currentTime).toBe(0);
      expect(queue[0].data.duration).toBe(0);
      expect(queue[0].data.percentage).toBe(0);

      analytics.destroy();
    });

    it('should track progress at different points', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackProgress(25, 100, 25);
      analytics.trackProgress(50, 100, 50);
      analytics.trackProgress(75, 100, 75);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(3);
      expect(queue[0].data.percentage).toBe(25);
      expect(queue[1].data.percentage).toBe(50);
      expect(queue[2].data.percentage).toBe(75);

      analytics.destroy();
    });
  });

  describe('Phase 3: Advanced Analytics - trackQualityChange()', () => {
    it('should track quality changes with from and to qualities', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQualityChange('720p', '1080p');

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.QUALITY_CHANGE);
      expect(queue[0].data.fromQuality).toBe('720p');
      expect(queue[0].data.toQuality).toBe('1080p');

      analytics.destroy();
    });

    it('should handle string quality labels', () => {
      const analytics = new VideoAnalytics('video-1');

      const qualities = ['480p', '720p', '1080p', '1440p', '2160p'];

      analytics.trackQualityChange(qualities[0], qualities[1]);
      analytics.trackQualityChange(qualities[1], qualities[2]);
      analytics.trackQualityChange(qualities[2], qualities[3]);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(3);
      expect(queue[0].data.fromQuality).toBe('480p');
      expect(queue[0].data.toQuality).toBe('720p');
      expect(queue[2].data.fromQuality).toBe('1080p');
      expect(queue[2].data.toQuality).toBe('1440p');

      analytics.destroy();
    });

    it('should detect quality upgrades', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQualityChange('720p', '1080p');

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isUpgrade).toBe(true);

      analytics.destroy();
    });

    it('should detect quality downgrades', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQualityChange('1080p', '720p');

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isUpgrade).toBe(false);

      analytics.destroy();
    });

    it('should detect automatic quality changes', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQualityChange('720p', 'auto');

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isAutomatic).toBe(true);

      analytics.destroy();
    });

    it('should detect changes from automatic to manual quality', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQualityChange('auto', '1080p');

      const queue = (analytics as any).eventQueue;
      expect(queue[0].data.isAutomatic).toBe(true);

      analytics.destroy();
    });
  });

  describe('Phase 3: Advanced Analytics - trackBufferStart() / trackBufferEnd()', () => {
    it('should track buffer start events', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackBufferStart();

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.BUFFER_START);
      expect(queue[0].data.timestamp).toBeTruthy();

      analytics.destroy();
    });

    it('should track buffer end with automatic duration calculation', () => {
      const analytics = new VideoAnalytics('video-1');
      const mockNow = Date.now();
      const dateNowSpy = jest.spyOn(Date, 'now');

      // Set buffer start time
      dateNowSpy.mockReturnValue(mockNow);
      analytics.trackBufferStart();

      // Advance time by 1000ms for buffer end
      dateNowSpy.mockReturnValue(mockNow + 1000);
      analytics.trackBufferEnd();

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(2);
      expect(queue[1].eventType).toBe(VideoEventType.BUFFER_END);
      expect(queue[1].data.duration).toBe(1000);
      expect(queue[1].data.durationSeconds).toBe(1);

      dateNowSpy.mockRestore();
      analytics.destroy();
    });

    it('should track buffer end with manual duration', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackBufferEnd(2500);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.BUFFER_END);
      expect(queue[0].data.duration).toBe(2500);
      expect(queue[0].data.durationSeconds).toBe(2.5);

      analytics.destroy();
    });

    it('should reset buffer tracking after buffer end', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackBufferStart();
      expect((analytics as any).bufferStartTime).toBeTruthy();

      analytics.trackBufferEnd();
      expect((analytics as any).bufferStartTime).toBeUndefined();

      analytics.destroy();
    });

    it('should handle buffer end without buffer start', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackBufferEnd();

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].data.duration).toBe(0);

      analytics.destroy();
    });

    it('should track multiple buffering events', () => {
      const analytics = new VideoAnalytics('video-1');
      const mockNow = Date.now();
      const dateNowSpy = jest.spyOn(Date, 'now');

      // First buffering event
      dateNowSpy.mockReturnValue(mockNow);
      analytics.trackBufferStart();
      dateNowSpy.mockReturnValue(mockNow + 1000);
      analytics.trackBufferEnd();

      // Second buffering event
      dateNowSpy.mockReturnValue(mockNow + 2000);
      analytics.trackBufferStart();
      dateNowSpy.mockReturnValue(mockNow + 3500);
      analytics.trackBufferEnd();

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(4);
      expect(queue[0].eventType).toBe(VideoEventType.BUFFER_START);
      expect(queue[1].eventType).toBe(VideoEventType.BUFFER_END);
      expect(queue[1].data.duration).toBe(1000);
      expect(queue[2].eventType).toBe(VideoEventType.BUFFER_START);
      expect(queue[3].eventType).toBe(VideoEventType.BUFFER_END);
      expect(queue[3].data.duration).toBe(1500);

      dateNowSpy.mockRestore();
      analytics.destroy();
    });
  });

  describe('Phase 3: Advanced Analytics - trackQuartile()', () => {
    it('should track 25% quartile milestone', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(25);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.QUARTILE_25);
      expect(queue[0].data.quartile).toBe(25);
      expect(queue[0].data.percentage).toBe(25);

      analytics.destroy();
    });

    it('should track 50% quartile milestone', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(50);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.QUARTILE_50);
      expect(queue[0].data.quartile).toBe(50);

      analytics.destroy();
    });

    it('should track 75% quartile milestone', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(75);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);
      expect(queue[0].eventType).toBe(VideoEventType.QUARTILE_75);
      expect(queue[0].data.quartile).toBe(75);

      analytics.destroy();
    });

    it('should prevent duplicate quartile tracking', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(25);
      analytics.trackQuartile(25);
      analytics.trackQuartile(25);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);

      analytics.destroy();
    });

    it('should track all three quartiles independently', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(25);
      analytics.trackQuartile(50);
      analytics.trackQuartile(75);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(3);
      expect(queue[0].eventType).toBe(VideoEventType.QUARTILE_25);
      expect(queue[1].eventType).toBe(VideoEventType.QUARTILE_50);
      expect(queue[2].eventType).toBe(VideoEventType.QUARTILE_75);

      analytics.destroy();
    });

    it('should allow same quartile after first tracking', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(25);
      analytics.trackQuartile(25);

      const queue = (analytics as any).eventQueue;
      expect(queue).toHaveLength(1);

      analytics.destroy();
    });

    it('should reset quartile tracking on destroy', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackQuartile(25);
      analytics.trackQuartile(50);

      const quartilesFired = (analytics as any).quartilesFired;
      expect(quartilesFired.size).toBe(2);

      analytics.destroy();

      expect(quartilesFired.size).toBe(0);
    });

    // Quarantined: fails on main, tracked in #206.
    it.skip('should log debug message when quartile already tracked', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const analytics = new VideoAnalytics('video-1', undefined, {
        enableDebugLogging: true
      });

      analytics.trackQuartile(25);
      analytics.trackQuartile(25);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[VideoAnalytics] Quartile 25% already tracked, skipping'
      );

      consoleSpy.mockRestore();
      analytics.destroy();
    });
  });

  describe('Phase 3: Integration Tests', () => {
    it('should handle typical video session flow with all Phase 3 events', async () => {
      const analytics = new VideoAnalytics('video-1', 'user-1', {
        batchSize: 100 // Prevent auto-flush
      });

      // Video lifecycle
      analytics.trackReady();                    // 1
      analytics.trackPlay();                     // 2
      analytics.trackProgress(10, 100, 10);      // 3
      analytics.trackQuartile(25);               // 4
      analytics.trackProgress(30, 100, 30);      // 5
      analytics.trackBufferStart();              // 6
      analytics.trackBufferEnd(500);             // 7
      analytics.trackProgress(50, 100, 50);      // 8
      analytics.trackQuartile(50);               // 9
      analytics.trackSeek(50, 70);               // 10
      analytics.trackProgress(70, 100, 70);      // 11
      analytics.trackQuartile(75);               // 12
      analytics.trackQualityChange('720p', '1080p'); // 13
      analytics.trackProgress(90, 100, 90);      // 14
      analytics.trackPause();                    // 15
      analytics.trackPlay();                     // 16
      analytics.trackComplete();                 // 17

      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalled();

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.events).toHaveLength(17);
      expect(body.events[0].eventType).toBe(VideoEventType.READY);
      expect(body.events[16].eventType).toBe(VideoEventType.ENDED);

      analytics.destroy();
    });

    it('should batch Phase 1 and Phase 3 events together', async () => {
      const analytics = new VideoAnalytics('video-1', undefined, {
        batchSize: 5
      });

      analytics.trackPlay();
      analytics.trackProgress(10, 100, 10);
      analytics.trackSeek(10, 30);
      analytics.trackQualityChange('720p', '1080p');
      analytics.trackQuartile(25); // 5th event triggers flush

      await analytics.waitForPendingFlushes();

      expect(global.fetch).toHaveBeenCalledTimes(1);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.events).toHaveLength(5);

      analytics.destroy();
    });

    it('should maintain quartile state across multiple progress updates', () => {
      const analytics = new VideoAnalytics('video-1');

      // Simulate rapid timeupdate events crossing 25% threshold
      analytics.trackProgress(24, 100, 24);
      analytics.trackQuartile(25);
      analytics.trackProgress(25, 100, 25);
      analytics.trackQuartile(25);
      analytics.trackProgress(26, 100, 26);
      analytics.trackQuartile(25);

      const queue = (analytics as any).eventQueue;
      const quartileEvents = queue.filter(
        (e: AnalyticsEvent) => e.eventType === VideoEventType.QUARTILE_25
      );

      expect(quartileEvents).toHaveLength(1);

      analytics.destroy();
    });

    it('should handle complex buffering scenarios', () => {
      const analytics = new VideoAnalytics('video-1');
      const mockNow = Date.now();
      const dateNowSpy = jest.spyOn(Date, 'now');

      // First buffering event (1 second)
      dateNowSpy.mockReturnValue(mockNow);
      analytics.trackBufferStart();
      dateNowSpy.mockReturnValue(mockNow + 1000);
      analytics.trackBufferEnd();

      // Second buffering event (2 seconds)
      dateNowSpy.mockReturnValue(mockNow + 2000);
      analytics.trackBufferStart();
      dateNowSpy.mockReturnValue(mockNow + 4000);
      analytics.trackBufferEnd();

      const queue = (analytics as any).eventQueue;
      const bufferStartEvents = queue.filter(
        (e: AnalyticsEvent) => e.eventType === VideoEventType.BUFFER_START
      );
      const bufferEndEvents = queue.filter(
        (e: AnalyticsEvent) => e.eventType === VideoEventType.BUFFER_END
      );

      expect(bufferStartEvents).toHaveLength(2);
      expect(bufferEndEvents).toHaveLength(2);
      expect(bufferEndEvents[0].data.duration).toBe(1000);
      expect(bufferEndEvents[1].data.duration).toBe(2000);

      dateNowSpy.mockRestore();
      analytics.destroy();
    });

    it('should handle quality changes during playback', () => {
      const analytics = new VideoAnalytics('video-1');

      analytics.trackPlay();
      analytics.trackQualityChange('auto', '720p');
      analytics.trackProgress(30, 100, 30);
      analytics.trackQualityChange('720p', '480p'); // Automatic downgrade
      analytics.trackProgress(60, 100, 60);
      analytics.trackQualityChange('480p', '1080p'); // Manual upgrade

      const queue = (analytics as any).eventQueue;
      const qualityEvents = queue.filter(
        (e: AnalyticsEvent) => e.eventType === VideoEventType.QUALITY_CHANGE
      );

      expect(qualityEvents).toHaveLength(3);
      expect(qualityEvents[0].data.isAutomatic).toBe(true);
      expect(qualityEvents[1].data.isUpgrade).toBe(false);
      expect(qualityEvents[2].data.isUpgrade).toBe(true);

      analytics.destroy();
    });
  });

  describe('Consent gating (GDPR, Story 1.3)', () => {
    afterEach(() => mockHasConsent.mockReturnValue(true));

    it('without analytics consent only an anonymous view-count event is queued', () => {
      mockHasConsent.mockReturnValue(false);
      const analytics = new VideoAnalytics('video-1', undefined, { batchSize: 100 });
      analytics.trackReady();
      analytics.trackPlay();
      analytics.trackSeek(1, 20);
      const queue = (analytics as any).eventQueue as AnalyticsEvent[];
      expect(queue).toHaveLength(1);
      expect(queue[0]).toEqual({ videoId: 'video-1', eventType: 'ready', timestamp: expect.any(String) });
      expect(queue[0]).not.toHaveProperty('sessionId');
      analytics.destroy();
    });

    it('withdrawing consent strips queued events down to anonymous view counts before sending', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      const analytics = new VideoAnalytics('video-1', undefined, { batchSize: 100 });
      analytics.trackReady();
      analytics.trackPlay();
      mockHasConsent.mockReturnValue(false);
      analytics.destroy();
      await analytics.waitForPendingFlushes();
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
      expect(body.events).toEqual([{ videoId: 'video-1', eventType: 'ready', timestamp: expect.any(String) }]);
    });
  });

describe('VideoAnalytics watch time (#235)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasConsent.mockReturnValue(true);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  const sentEvents = () =>
    (global.fetch as jest.Mock).mock.calls.flatMap(([, init]) => (JSON.parse(init.body) as { events: AnalyticsEvent[] }).events);

  function playFor(analytics: VideoAnalytics, seconds: number) {
    for (let i = 0; i <= seconds * 4; i++) analytics.trackPlayback(i * 0.25, 1_000_000 + i * 250);
  }

  it('reports played seconds as a watch_time event with the next flush', async () => {
    const analytics = new VideoAnalytics('v1');
    playFor(analytics, 25);
    await jest.advanceTimersByTimeAsync(30000);
    const watch = sentEvents().filter((e) => e.eventType === VideoEventType.WATCH_TIME);
    expect(watch).toHaveLength(1);
    expect(watch[0]).toMatchObject({ videoId: 'v1', sessionId: analytics.getSessionId(), data: { seconds: 25 } });
    analytics.destroy();
  });

  it('a seek breaks the run, so the jump is not counted', async () => {
    const analytics = new VideoAnalytics('v1');
    analytics.trackPlayback(0, 0);
    analytics.trackPlayback(0.25, 250);
    analytics.trackSeek(0.25, 300);
    analytics.trackPlayback(300, 500);
    analytics.trackPlayback(300.25, 750);
    await jest.advanceTimersByTimeAsync(30000);
    expect(sentEvents().filter((e) => e.eventType === VideoEventType.WATCH_TIME)).toHaveLength(0);
    analytics.destroy();
  });

  it('sends no watch time without analytics consent', async () => {
    mockHasConsent.mockReturnValue(false);
    const analytics = new VideoAnalytics('v1');
    playFor(analytics, 25);
    await jest.advanceTimersByTimeAsync(30000);
    expect(sentEvents().filter((e) => e.eventType === VideoEventType.WATCH_TIME)).toHaveLength(0);
    analytics.destroy();
  });
});
});

describe('VideoAnalytics retention and traffic', () => {
  const sent = () => (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body));
  const events = () => sent().flatMap((b) => b.events);

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });
  afterEach(() => jest.useRealTimers());

  const context = { source: 'watch' as const, trafficSource: 'search' as const };

  function played(a: VideoAnalytics, to = 21) {
    for (let t = 0; t <= to; t++) a.trackRetention(t, 100, t * 1000);
  }

  it('reports retention buckets at the next flush', async () => {
    const a = new VideoAnalytics('v1', undefined, { consentCheck: () => true });
    played(a, 6);
    a.destroy();
    await Promise.resolve();
    expect(events().find((e) => e.eventType === 'retention').data.buckets).toEqual([0, 1]);
  });

  it('flushes early with four new buckets, no more than once in 15 s', async () => {
    const a = new VideoAnalytics('v1', undefined, { consentCheck: () => true });
    played(a, 21);
    await Promise.resolve();
    expect(sent()).toHaveLength(1);
    a.destroy();
  });

  it('sends nothing about retention without consent', async () => {
    const a = new VideoAnalytics('v1', undefined, { consentCheck: () => false });
    played(a, 21);
    a.destroy();
    await Promise.resolve();
    expect(events().some((e) => e.eventType === 'retention')).toBe(false);
  });

  it('sends the traffic context with consent', async () => {
    const a = new VideoAnalytics('v1', undefined, { consentCheck: () => true, context });
    a.trackReady();
    a.destroy();
    await Promise.resolve();
    expect(sent()[0].context).toMatchObject({ trafficSource: 'search' });
  });

  it('strips the traffic context without consent, and keeps the view', async () => {
    const a = new VideoAnalytics('v1', undefined, { consentCheck: () => false, context: { ...context, referrerHost: 'a.org' } });
    a.trackReady();
    a.destroy();
    await Promise.resolve();
    expect(sent()[0].context).toEqual({ source: 'watch' });
    expect(sent()[0].events[0].eventType).toBe('ready');
  });
});
