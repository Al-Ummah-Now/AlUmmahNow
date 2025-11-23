/**
 * Memory Leak Fix Test for VideoPerformanceMonitor
 *
 * This test verifies the memory leak fix for the watchStartTimes Map
 * that was previously growing unboundedly.
 */

// Mock DOM APIs
const mockVideoElement = {
  currentTime: 0,
  duration: 100,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
} as unknown as HTMLVideoElement;

// Mock performance.now
global.performance = {
  now: jest.fn(() => 1000),
} as unknown as Performance;

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
  })
) as unknown as typeof fetch;

// Mock auth module
jest.mock('@/lib/auth/client-token', () => ({
  getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

import { VideoPerformanceMonitor } from '../video-performance';

describe('VideoPerformanceMonitor - Memory Leak Fix', () => {
  let monitor: VideoPerformanceMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (monitor) {
      monitor.destroy();
    }
    jest.useRealTimers();
  });

  test('watchStartTimes Map should not grow beyond MAX_WATCH_ENTRIES', () => {
    // Create monitor with auto-send disabled to prevent background tasks
    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: false,
    });

    // Access private property for testing (TypeScript hack)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getMapSize = () => (monitor as any).watchStartTimes.size;

    // Initial state
    expect(getMapSize()).toBe(0);

    // Simulate multiple play events beyond the max limit
    for (let i = 0; i < 20; i++) {
      // Trigger play event
      const playHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
        .find(call => call[0] === 'play')?.[1];
      if (playHandler) {
        playHandler();
      }

      // Advance time to ensure different timestamps
      jest.advanceTimersByTime(1000);
    }

    // Map size should never exceed MAX_WATCH_ENTRIES (10)
    expect(getMapSize()).toBeLessThanOrEqual(10);
  });

  test('stale entries should be removed during periodic cleanup', () => {
    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getMapSize = () => (monitor as any).watchStartTimes.size;
    const playHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'play')?.[1];

    // Add some entries
    if (playHandler) {
      playHandler();
      jest.advanceTimersByTime(1000);
      playHandler();
      jest.advanceTimersByTime(1000);
      playHandler();
    }

    expect(getMapSize()).toBe(3);

    // Advance time beyond STALE_ENTRY_TIMEOUT (1 hour)
    jest.advanceTimersByTime(3700000); // 1 hour + 100 seconds

    // Trigger cleanup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (monitor as any).cleanupStaleEntries();

    // All entries should be removed as stale
    expect(getMapSize()).toBe(0);
  });

  test('cleanup timer should be set and cleared properly', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: false,
    });

    // Verify cleanup timer is set
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      300000 // 5 minutes
    );

    // Destroy monitor
    monitor.destroy();

    // Verify cleanup timer is cleared
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  test('simplified tracking should work alongside Map', () => {
    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: false,
    });

    const playHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'play')?.[1];
    const pauseHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'pause')?.[1];

    // Simulate play
    if (playHandler) {
      playHandler();
    }

    // Check that currentWatchStartTime is set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((monitor as any).currentWatchStartTime).toBeGreaterThan(0);

    // Advance time and pause
    jest.advanceTimersByTime(5000);
    if (pauseHandler) {
      pauseHandler();
    }

    // currentWatchStartTime should be reset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((monitor as any).currentWatchStartTime).toBe(0);

    // totalDurationWatched should have increased
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((monitor as any).totalDurationWatched).toBeGreaterThan(0);
  });

  test('destroy should clear Map and all timers', () => {
    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: true, // Enable to test timer cleanup
    });

    const playHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'play')?.[1];

    // Add some entries
    if (playHandler) {
      playHandler();
      jest.advanceTimersByTime(1000);
      playHandler();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getMapSize = () => (monitor as any).watchStartTimes.size;
    expect(getMapSize()).toBeGreaterThan(0);

    // Destroy monitor
    monitor.destroy();

    // Map should be cleared
    expect(getMapSize()).toBe(0);

    // Timers should be null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((monitor as any).sendTimer).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((monitor as any).cleanupTimer).toBeNull();
  });

  test('memory usage remains bounded under continuous operation', () => {
    monitor = new VideoPerformanceMonitor(mockVideoElement, {
      enableAutoSend: false,
    });

    const playHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'play')?.[1];
    const pauseHandler = (mockVideoElement.addEventListener as jest.Mock).mock.calls
      .find(call => call[0] === 'pause')?.[1];

    // Simulate 100 play/pause cycles
    for (let i = 0; i < 100; i++) {
      if (playHandler) playHandler();
      jest.advanceTimersByTime(5000);
      if (pauseHandler) pauseHandler();
      jest.advanceTimersByTime(1000);
    }

    // Map size should still be bounded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getMapSize = () => (monitor as any).watchStartTimes.size;
    expect(getMapSize()).toBeLessThanOrEqual(10);

    // Simulate periodic cleanup
    jest.advanceTimersByTime(300000); // 5 minutes

    // Map should be empty after cleanup (all paused)
    expect(getMapSize()).toBe(0);
  });
});