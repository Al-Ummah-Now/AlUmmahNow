/**
 * Video Player Performance Monitor
 *
 * Monitors and tracks performance metrics for the video player.
 * Provides insights into rendering performance, user interactions,
 * and potential bottlenecks.
 *
 * Features:
 * - FPS monitoring during playback
 * - Interaction timing measurements
 * - Memory usage tracking
 * - Performance warnings
 * - Debug logging in development
 */

import type { ExtendedPlayer } from './videojs';

interface PerformanceMetrics {
  fps: number;
  averageFrameTime: number;
  droppedFrames: number;
  interactionTime: number;
  memoryUsage?: number;
}

interface PerformanceWarning {
  type: 'low-fps' | 'high-memory' | 'slow-interaction';
  message: string;
  timestamp: number;
  value: number;
}

export class VideoPerformanceMonitor {
  private isMonitoring = false;
  private frameCount = 0;
  private lastFrameTime = 0;
  private droppedFrames = 0;
  private frameTimes: number[] = [];
  private warnings: PerformanceWarning[] = [];
  private observers: PerformanceObserver[] = [];
  private player: ExtendedPlayer;
  
  // Performance thresholds
  private readonly FPS_THRESHOLD = 30;
  private readonly MEMORY_THRESHOLD = 100 * 1024 * 1024; // 100MB
  private readonly INTERACTION_THRESHOLD = 100; // 100ms
  
  constructor(player: ExtendedPlayer) {
    this.player = player;
  }

  /**
   * Start performance monitoring
   */
  start(): void {
    if (this.isMonitoring || typeof window === 'undefined') return;
    
    this.isMonitoring = true;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.droppedFrames = 0;
    this.frameTimes = [];
    this.warnings = [];

    console.log('[VideoPerformance] Starting monitoring');
    
    this.startFrameMonitoring();
    this.startInteractionMonitoring();
    
    if (process.env.NODE_ENV === 'development') {
      this.startMemoryMonitoring();
    }
  }

  /**
   * Stop performance monitoring
   */
  stop(): void {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    // Clean up observers
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
    
    console.log('[VideoPerformance] Stopped monitoring');
  }

  /**
    * Get the associated player instance
    */
  getPlayer(): ExtendedPlayer {
    return this.player;
  }

  /**
    * Get current performance metrics
    */
  getMetrics(): PerformanceMetrics {
    const now = performance.now();
    const totalTime = now - this.lastFrameTime;
    const averageFrameTime = this.frameTimes.length > 0 
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length 
      : 0;
    const fps = totalTime > 0 ? (this.frameCount / totalTime) * 1000 : 0;

    return {
      fps: Math.round(fps),
      averageFrameTime: Math.round(averageFrameTime * 100) / 100,
      droppedFrames: this.droppedFrames,
      interactionTime: 0, // Updated by interaction monitoring
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * Get performance warnings
   */
  getWarnings(): PerformanceWarning[] {
    return [...this.warnings];
  }

  /**
   * Clear performance warnings
   */
  clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Monitor frame rate using requestAnimationFrame
   */
  private startFrameMonitoring(): void {
    const monitorFrame = () => {
      if (!this.isMonitoring) return;

      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      
      this.frameCount++;
      this.frameTimes.push(frameTime);
      
      // Keep only last 60 frame times (1 second at 60fps)
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      
      // Check for dropped frames (frame time > 16.67ms for 60fps)
      if (frameTime > 16.67 * 2) { // Allow some tolerance
        this.droppedFrames++;
      }
      
      // Check FPS threshold
      const currentFps = 1000 / frameTime;
      if (currentFps < this.FPS_THRESHOLD && this.frameCount % 30 === 0) {
        this.addWarning('low-fps', `Low FPS detected: ${Math.round(currentFps)}`, currentFps);
      }
      
      this.lastFrameTime = now;
      requestAnimationFrame(monitorFrame);
    };

    requestAnimationFrame(monitorFrame);
  }

  /**
   * Monitor user interaction performance
   */
  private startInteractionMonitoring(): void {
    const measureInteraction = (entries: PerformanceObserverEntryList) => {
      const list = entries.getEntries();
      list.forEach(entry => {
        if (entry.entryType === 'measure') {
          const duration = entry.duration;
          
          if (duration > this.INTERACTION_THRESHOLD) {
            this.addWarning('slow-interaction', 
              `Slow interaction: ${entry.name} took ${Math.round(duration)}ms`, 
              duration);
          }
        }
      });
    };

    try {
      const observer = new PerformanceObserver(measureInteraction);
      observer.observe({ entryTypes: ['measure'] });
      this.observers.push(observer);
    } catch (error) {
      console.warn('[VideoPerformance] Performance observer not supported:', error);
    }
  }

  /**
   * Monitor memory usage (development only)
   */
  private startMemoryMonitoring(): void {
    if (!('memory' in performance)) return;

    const checkMemory = () => {
      if (!this.isMonitoring) return;

      const memory = (performance as any).memory;
      if (memory && memory.usedJSHeapSize) {
        const usage = memory.usedJSHeapSize;
        
        if (usage > this.MEMORY_THRESHOLD) {
          this.addWarning('high-memory', 
            `High memory usage: ${Math.round(usage / 1024 / 1024)}MB`, 
            usage);
        }
      }
      
      setTimeout(checkMemory, 5000); // Check every 5 seconds
    };

    setTimeout(checkMemory, 5000);
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      return (performance as any).memory?.usedJSHeapSize;
    }
    return undefined;
  }

  /**
   * Add a performance warning
   */
  private addWarning(type: PerformanceWarning['type'], message: string, value: number): void {
    const warning: PerformanceWarning = {
      type,
      message,
      timestamp: Date.now(),
      value
    };

    this.warnings.push(warning);
    
    // Keep only last 10 warnings
    if (this.warnings.length > 10) {
      this.warnings.shift();
    }

    console.warn(`[VideoPerformance] ${message}`);
  }

  /**
   * Measure a specific interaction
   */
  measureInteraction<T>(name: string, fn: () => T): T {
    const startMark = `${name}-start`;
    const endMark = `${name}-end`;
    const measureName = `${name}-duration`;

    performance.mark(startMark);
    
    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result.finally(() => {
          performance.mark(endMark);
          performance.measure(measureName, startMark, endMark);
        }) as T;
      } else {
        performance.mark(endMark);
        performance.measure(measureName, startMark, endMark);
        return result;
      }
    } catch (error) {
      performance.mark(endMark);
      performance.measure(measureName, startMark, endMark);
      throw error;
    }
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const metrics = this.getMetrics();
    const warnings = this.getWarnings();
    
    let report = `=== Video Player Performance Report ===\n`;
    report += `FPS: ${metrics.fps}\n`;
    report += `Average Frame Time: ${metrics.averageFrameTime}ms\n`;
    report += `Dropped Frames: ${metrics.droppedFrames}\n`;
    
    if (metrics.memoryUsage) {
      report += `Memory Usage: ${Math.round(metrics.memoryUsage / 1024 / 1024)}MB\n`;
    }
    
    if (warnings.length > 0) {
      report += `\nWarnings (${warnings.length}):\n`;
      warnings.forEach(warning => {
        report += `- ${warning.message}\n`;
      });
    } else {
      report += `\n✅ No performance warnings\n`;
    }
    
    return report;
  }
}

/**
 * Create and start performance monitoring for a player
 */
export function createPerformanceMonitor(player: ExtendedPlayer): VideoPerformanceMonitor {
  const monitor = new VideoPerformanceMonitor(player);
  
  // Auto-start in development
  if (process.env.NODE_ENV === 'development') {
    monitor.start();
  }
  
  return monitor;
}