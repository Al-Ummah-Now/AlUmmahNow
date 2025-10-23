/**
 * Performance Monitor Tests
 */

import { VideoPerformanceMonitor, createPerformanceMonitor } from '../performance-monitor';
import type { ExtendedPlayer } from '../videojs';

// Mock performance.now for consistent testing
const mockPerformanceNow = jest.fn();
Object.defineProperty(global.performance, 'now', {
  value: mockPerformanceNow,
  writable: true,
});

// Mock requestAnimationFrame
const mockRequestAnimationFrame = jest.fn();
Object.defineProperty(global, 'requestAnimationFrame', {
  value: mockRequestAnimationFrame,
  writable: true,
});

// Mock performance observer
const mockPerformanceObserver = jest.fn();
global.PerformanceObserver = mockPerformanceObserver as any;

describe('VideoPerformanceMonitor', () => {
  let monitor: VideoPerformanceMonitor;
  let mockPlayer: ExtendedPlayer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer = {} as ExtendedPlayer;
    monitor = new VideoPerformanceMonitor(mockPlayer);
    
    // Setup default performance.now behavior
    let time = 0;
    mockPerformanceNow.mockImplementation(() => {
      time += 16; // Simulate 60fps
      return time;
    });

    // Setup requestAnimationFrame to call callback immediately
    mockRequestAnimationFrame.mockImplementation((callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    monitor.stop();
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
      expect(monitor.getMetrics().fps).toBeGreaterThan(0);
      
      monitor.stop();
      // Should not throw when stopped
      monitor.getMetrics();
    });

    it('should not start monitoring twice', () => {
      monitor.start();
      const firstMetrics = monitor.getMetrics();
      
      monitor.start(); // Should not restart
      const secondMetrics = monitor.getMetrics();
      
      expect(firstMetrics.fps).toBe(secondMetrics.fps);
    });
  });

  describe('FPS monitoring', () => {
    it('should track frame rate correctly', () => {
      monitor.start();
      
      // Simulate a few frames
      jest.advanceTimersByTime(100);
      
      const metrics = monitor.getMetrics();
      expect(metrics.fps).toBeGreaterThan(0);
      expect(metrics.averageFrameTime).toBeGreaterThan(0);
    });

    it('should detect dropped frames', () => {
      monitor.start();
      
      // Simulate a slow frame (> 33ms)
      mockPerformanceNow.mockImplementation(() => 50);
      
      const metrics = monitor.getMetrics();
      expect(metrics.droppedFrames).toBeGreaterThan(0);
    });
  });

  describe('interaction measurement', () => {
    it('should measure interaction timing', () => {
      const result = monitor.measureInteraction('test-action', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should measure async interaction timing', async () => {
      const result = monitor.measureInteraction('async-action', async () => {
        return Promise.resolve('async-result');
      });

      expect(await result).toBe('async-result');
    });

    it('should handle interaction errors', () => {
      expect(() => {
        monitor.measureInteraction('error-action', () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');
    });
  });

  describe('warnings system', () => {
    it('should track low FPS warnings', () => {
      monitor.start();
      
      // Simulate very low FPS
      mockPerformanceNow.mockImplementation(() => 100); // 10fps
      
      jest.advanceTimersByTime(1000);
      
      const warnings = monitor.getWarnings();
      expect(warnings.some(w => w.type === 'low-fps')).toBe(true);
    });

    it('should clear warnings', () => {
      monitor.start();
      
      // Trigger a warning
      mockPerformanceNow.mockImplementation(() => 100);
      jest.advanceTimersByTime(1000);
      
      expect(monitor.getWarnings().length).toBeGreaterThan(0);
      
      monitor.clearWarnings();
      expect(monitor.getWarnings()).toHaveLength(0);
    });
  });

  describe('memory monitoring', () => {
    beforeEach(() => {
      // Mock memory API
      Object.defineProperty(global.performance, 'memory', {
        value: {
          usedJSHeapSize: 50 * 1024 * 1024, // 50MB
        },
        writable: true,
      });
    });

    it('should track memory usage when available', () => {
      monitor.start();
      
      const metrics = monitor.getMetrics();
      expect(metrics.memoryUsage).toBe(50 * 1024 * 1024);
    });

    it('should handle missing memory API', () => {
      delete (global.performance as any).memory;
      
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

    it('should include warnings in report', () => {
      monitor.start();
      
      // Trigger a warning
      mockPerformanceNow.mockImplementation(() => 100);
      jest.advanceTimersByTime(1000);
      
      const report = monitor.generateReport();
      expect(report).toContain('Warnings');
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
      mockPerformanceObserver.mockImplementation(() => {
        throw new Error('PerformanceObserver not supported');
      });
      
      expect(() => {
        monitor.start();
      }).not.toThrow();
    });
  });
});