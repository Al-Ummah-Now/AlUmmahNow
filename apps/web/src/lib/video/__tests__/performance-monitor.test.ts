/**
 * Performance Monitor Tests - Simplified Version
 */

// Mock performance before importing module
const mockPerformanceNow = jest.fn();
const mockPerformanceMark = jest.fn();
const mockPerformanceMeasure = jest.fn();

// Mock performance observer
const mockPerfObserver = jest.fn().mockImplementation((_callback) => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn(() => []),
}));
global.PerformanceObserver = mockPerfObserver as any;

// Mock window object if not present
if (typeof window === 'undefined') {
  (global as any).window = {};
}

import { VideoPerformanceMonitor, createPerformanceMonitor } from '../performance-monitor';
import type { ExtendedPlayer } from '../videojs';

describe('VideoPerformanceMonitor', () => {
  let monitor: VideoPerformanceMonitor;
  let mockPlayer: ExtendedPlayer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Add missing methods to Jest's performance object AFTER fake timers are set up
    (global as any).performance.mark = mockPerformanceMark;
    (global as any).performance.measure = mockPerformanceMeasure;
    (global as any).performance.memory = {
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
      jsHeapSizeLimit: 4000000,
    };
    
    // Setup default performance.now behavior
    let time = 0;
    mockPerformanceNow.mockImplementation(() => {
      time += 16; // Simulate 60fps
      return time;
    });
    
    // Ensure performance methods are properly mocked
    mockPerformanceMark.mockImplementation(() => {});
    mockPerformanceMeasure.mockImplementation(() => {});
    
    mockPlayer = {} as ExtendedPlayer;
    monitor = new VideoPerformanceMonitor(mockPlayer);
  });

  afterEach(() => {
    monitor.stop();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create monitor with default state', () => {
      expect(monitor.getMetrics().fps).toBe(0);
      expect(monitor.getMetrics().droppedFrames).toBe(0);
      expect(monitor.getWarnings()).toHaveLength(0);
    });

    it('should create monitor with factory function', () => {
      const factoryMonitor = createPerformanceMonitor(mockPlayer);
      expect(factoryMonitor).toBeInstanceOf(VideoPerformanceMonitor);
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start and stop monitoring', () => {
      monitor.start();
      expect(monitor.getMetrics().fps).toBe(0); // Initially 0 until frames are processed
      
      monitor.stop();
      // Should not throw and metrics should be accessible
      const metrics = monitor.getMetrics();
      expect(typeof metrics.fps).toBe('number');
    });

    it('should not start monitoring twice', () => {
      monitor.start();
      const firstMetrics = monitor.getMetrics();
      
      monitor.start(); // Should not restart
      const secondMetrics = monitor.getMetrics();
      
      expect(firstMetrics.fps).toBe(secondMetrics.fps);
    });
  });

  describe('interaction measurement', () => {
    it('should measure interaction timing', () => {
      const result = monitor.measureInteraction('test-action', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
      expect(mockPerformanceMark).toHaveBeenCalledWith('test-action-start');
      expect(mockPerformanceMark).toHaveBeenCalledWith('test-action-end');
      expect(mockPerformanceMeasure).toHaveBeenCalledWith('test-action-duration', 'test-action-start', 'test-action-end');
    });

    it('should measure async interaction timing', async () => {
      const result = monitor.measureInteraction('async-action', async () => {
        return Promise.resolve('async-result');
      });

      expect(await result).toBe('async-result');
      expect(mockPerformanceMark).toHaveBeenCalledWith('async-action-start');
      expect(mockPerformanceMark).toHaveBeenCalledWith('async-action-end');
      expect(mockPerformanceMeasure).toHaveBeenCalledWith('async-action-duration', 'async-action-start', 'async-action-end');
    });

    it('should handle interaction errors', () => {
      expect(() => {
        monitor.measureInteraction('error-action', () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');
      
      // Should still mark performance even on error
      expect(mockPerformanceMark).toHaveBeenCalledWith('error-action-start');
      expect(mockPerformanceMark).toHaveBeenCalledWith('error-action-end');
      expect(mockPerformanceMeasure).toHaveBeenCalledWith('error-action-duration', 'error-action-start', 'error-action-end');
    });
  });

  describe('warnings system', () => {
    it('should clear warnings', () => {
      monitor.start();
      
      // Initially no warnings
      expect(monitor.getWarnings()).toHaveLength(0);
      
      monitor.clearWarnings();
      expect(monitor.getWarnings()).toHaveLength(0);
    });
  });

  describe('memory monitoring', () => {
    it('should track memory usage when available', () => {
      monitor.start();
      
      const metrics = monitor.getMetrics();
      expect(metrics.memoryUsage).toBe(1000000);
    });

    it('should handle missing memory API', () => {
      // Mock memory as undefined
      Object.defineProperty(global.performance, 'memory', {
        value: undefined,
        writable: true,
      });
      
      monitor.start();
      
      const metrics = monitor.getMetrics();
      expect(metrics.memoryUsage).toBeUndefined();
    });
  });

  describe('performance reporting', () => {
    it('should generate performance report', () => {
      monitor.start();
      
      const report = monitor.generateReport();
      
      expect(report).toContain('Video Player Performance Report');
      expect(report).toContain('FPS:');
      expect(report).toContain('Average Frame Time:');
      expect(report).toContain('Dropped Frames:');
    });
  });

  describe('edge cases', () => {
    it('should handle server-side environment', () => {
      // Mock server environment
      const originalWindow = global.window;
      delete (global as any).window;
      
      const serverMonitor = new VideoPerformanceMonitor(mockPlayer);
      serverMonitor.start();
      
      expect(serverMonitor.getMetrics().fps).toBe(0);
      
      // Restore window
      global.window = originalWindow;
    });

    it('should handle performance observer not supported', () => {
      mockPerfObserver.mockImplementation(() => {
        throw new Error('PerformanceObserver not supported');
      });
      
      expect(() => {
        monitor.start();
      }).not.toThrow();
    });
  });

  describe('player integration', () => {
    it('should return associated player', () => {
      expect(monitor.getPlayer()).toBe(mockPlayer);
    });
  });
});