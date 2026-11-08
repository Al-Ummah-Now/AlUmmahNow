import { logger } from '@/lib/logger-client';
import { hasConsent } from '@/lib/consent/ConsentManager';
interface PerformanceMetrics {
  timeToFirstFrame: number;
  rebufferCount: number;
  totalRebufferDuration: number;
  averageBitrate: number;
  qualityChanges: number;
  watchTime: number;
  completionRate: number;
  engagementRate: number;
  errorRate: number;
  errorTypes: Record<string, number> | Map<string, number>;
}

interface PerformanceConfig {
  analyticsEndpoint: string;
  enableAutoSend: boolean;
  sendInterval: number;
  batchSize: number;
}

export class VideoPerformanceMonitor {
  private metrics: PerformanceMetrics;
  private config: PerformanceConfig;
  private videoElement: HTMLVideoElement;
  private startTime: number = 0;
  private firstFrameTime: number = 0;
  private lastQualityLevel: string = '';
  private rebufferStartTime: number = 0;
  private currentWatchStartTime: number = 0;  // Track single session instead of Map
  private totalDurationWatched: number = 0;
  private isPlaying: boolean = false;
  private sendTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;  // For periodic cleanup

  // Legacy Map with size limits and cleanup (for backwards compatibility if needed)
  private watchStartTimes: Map<number, number> = new Map();
  private readonly MAX_WATCH_ENTRIES = 10;  // Maximum entries to prevent unbounded growth
  private readonly STALE_ENTRY_TIMEOUT = 3600000; // 1 hour in milliseconds

  constructor(videoElement: HTMLVideoElement, config: Partial<PerformanceConfig> = {}) {
    this.videoElement = videoElement;
    this.config = {
      analyticsEndpoint: '/api/analytics/performance',
      enableAutoSend: true,
      sendInterval: 30000,
      batchSize: 10,
      ...config
    };

    this.metrics = {
      timeToFirstFrame: 0,
      rebufferCount: 0,
      totalRebufferDuration: 0,
      averageBitrate: 0,
      qualityChanges: 0,
      watchTime: 0,
      completionRate: 0,
      engagementRate: 0,
      errorRate: 0,
      errorTypes: new Map()
    };

    this.initializeEventListeners();
    if (this.config.enableAutoSend) {
      this.startAutoSend();
    }
    // Start periodic cleanup to prevent memory leaks
    this.startPeriodicCleanup();
  }

  private initializeEventListeners(): void {
    this.videoElement.addEventListener('loadstart', this.handleLoadStart.bind(this));
    this.videoElement.addEventListener('loadeddata', this.handleLoadedData.bind(this));
    this.videoElement.addEventListener('canplay', this.handleCanPlay.bind(this));
    this.videoElement.addEventListener('play', this.handlePlay.bind(this));
    this.videoElement.addEventListener('pause', this.handlePause.bind(this));
    this.videoElement.addEventListener('waiting', this.handleWaiting.bind(this));
    this.videoElement.addEventListener('playing', this.handlePlaying.bind(this));
    this.videoElement.addEventListener('ended', this.handleEnded.bind(this));
    this.videoElement.addEventListener('error', this.handleError.bind(this));
    this.videoElement.addEventListener('timeupdate', this.handleTimeUpdate.bind(this));
  }

  private handleLoadStart(): void {
    this.startTime = performance.now();
  }

  private handleLoadedData(): void {
    if (this.firstFrameTime === 0) {
      this.firstFrameTime = performance.now();
      this.metrics.timeToFirstFrame = this.firstFrameTime - this.startTime;
    }
  }

  private handleCanPlay(): void {
    if (this.firstFrameTime === 0) {
      this.firstFrameTime = performance.now();
      this.metrics.timeToFirstFrame = this.firstFrameTime - this.startTime;
    }
  }

  private handlePlay(): void {
    this.isPlaying = true;
    // Use simplified single session tracking
    this.currentWatchStartTime = Date.now();

    // Also maintain backwards compatible Map with size limit
    const now = Date.now();
    this.watchStartTimes.set(now, this.videoElement.currentTime);

    // Enforce max size limit - remove oldest entries if exceeded
    if (this.watchStartTimes.size > this.MAX_WATCH_ENTRIES) {
      const sortedKeys = Array.from(this.watchStartTimes.keys()).sort((a, b) => a - b);
      const entriesToRemove = sortedKeys.slice(0, this.watchStartTimes.size - this.MAX_WATCH_ENTRIES);
      entriesToRemove.forEach(key => this.watchStartTimes.delete(key));
    }
  }

  private handlePause(): void {
    this.isPlaying = false;
    // Update watch time using simplified tracking
    if (this.currentWatchStartTime > 0) {
      const watchDuration = (Date.now() - this.currentWatchStartTime) / 1000;
      this.totalDurationWatched += watchDuration;
      this.currentWatchStartTime = 0;
    }
    // Also update using legacy Map method for backwards compatibility
    this.updateWatchTime();
  }

  private handleWaiting(): void {
    this.rebufferStartTime = performance.now();
  }

  private handlePlaying(): void {
    if (this.rebufferStartTime > 0) {
      const rebufferDuration = performance.now() - this.rebufferStartTime;
      this.metrics.rebufferCount++;
      this.metrics.totalRebufferDuration += rebufferDuration;
      this.rebufferStartTime = 0;
    }
  }

  private handleEnded(): void {
    this.isPlaying = false;
    // Update watch time using simplified tracking
    if (this.currentWatchStartTime > 0) {
      const watchDuration = (Date.now() - this.currentWatchStartTime) / 1000;
      this.totalDurationWatched += watchDuration;
      this.currentWatchStartTime = 0;
    }
    // Also update using legacy Map method for backwards compatibility
    this.updateWatchTime();
    this.metrics.completionRate = this.videoElement.currentTime / this.videoElement.duration;
  }

  private handleError(event: Event): void {
    const error = (event.target as HTMLVideoElement).error;
    const errorKey = error ? `code_${error.code}` : 'unknown';
    const errorTypes = this.metrics.errorTypes as Map<string, number>;
    errorTypes.set(errorKey, (errorTypes.get(errorKey) || 0) + 1);
    this.metrics.errorRate = Array.from(errorTypes.values()).reduce((a, b) => a + b, 0);
  }

  private handleTimeUpdate(): void {
    const currentBitrate = this.getCurrentBitrate();
    if (currentBitrate > 0) {
      this.metrics.averageBitrate = (this.metrics.averageBitrate + currentBitrate) / 2;
    }

    const currentQuality = this.getCurrentQuality();
    if (currentQuality && currentQuality !== this.lastQualityLevel) {
      if (this.lastQualityLevel) {
        this.metrics.qualityChanges++;
      }
      this.lastQualityLevel = currentQuality;
    }
  }

  private getCurrentBitrate(): number {
    if ('getVideoPlaybackQuality' in this.videoElement) {
      const quality = (this.videoElement as HTMLVideoElement & { getVideoPlaybackQuality: () => VideoPlaybackQuality }).getVideoPlaybackQuality();
      const totalBytes = quality.totalVideoFrames || 0;
      const totalFrames = quality.droppedVideoFrames || 1;
      return totalBytes > 0 ? (totalBytes * 8) / (totalFrames * 0.033) : 0;
    }
    return 0;
  }

  private getCurrentQuality(): string {
    if ('webkitVideoDecodedByteCount' in this.videoElement) {
      const bytes = (this.videoElement as HTMLVideoElement & { webkitVideoDecodedByteCount: number }).webkitVideoDecodedByteCount;
      return bytes > 1000000 ? 'high' : bytes > 500000 ? 'medium' : 'low';
    }
    return 'unknown';
  }

  private updateWatchTime(): void {
    // Process and clear all entries in the Map
    const now = Date.now();
    for (const [startTime] of this.watchStartTimes) {
      // Skip stale entries (older than 1 hour)
      if (now - startTime > this.STALE_ENTRY_TIMEOUT) {
        this.watchStartTimes.delete(startTime);
        continue;
      }

      const watchDuration = (now - startTime) / 1000;
      this.totalDurationWatched += watchDuration;
      this.watchStartTimes.delete(startTime);
    }
    this.metrics.watchTime = this.totalDurationWatched;
    this.metrics.engagementRate = this.metrics.watchTime / (this.videoElement.duration || 1);
  }

  private startAutoSend(): void {
    this.sendTimer = setInterval(() => {
      this.sendMetrics();
    }, this.config.sendInterval);
  }

  private startPeriodicCleanup(): void {
    // Run cleanup every 5 minutes to remove stale entries
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleEntries();
    }, 300000); // 5 minutes
  }

  private cleanupStaleEntries(): void {
    const now = Date.now();
    const staleKeys: number[] = [];

    // Find all stale entries
    for (const [startTime] of this.watchStartTimes) {
      if (now - startTime > this.STALE_ENTRY_TIMEOUT) {
        staleKeys.push(startTime);
      }
    }

    // Remove stale entries
    staleKeys.forEach(key => {
      this.watchStartTimes.delete(key);
    });

    // Additional safety: if Map still exceeds max size, keep only recent entries
    if (this.watchStartTimes.size > this.MAX_WATCH_ENTRIES) {
      const sortedKeys = Array.from(this.watchStartTimes.keys()).sort((a, b) => b - a); // Sort descending (newest first)
      const keysToRemove = sortedKeys.slice(this.MAX_WATCH_ENTRIES);

      keysToRemove.forEach(key => {
        this.watchStartTimes.delete(key);
      });
    }
  }

  public async sendMetrics(): Promise<void> {
    // GDPR (Story 1.3): player QoS beacons require 'performance' consent.
    if (!hasConsent('performance')) return;
    try {
      const metricsToSend = this.prepareMetricsForSending();

      // Get auth token from cookies (client-side)
      const { getAuthHeaders } = await import('@/lib/auth/client-token');
      const authHeaders = getAuthHeaders();

      const response = await fetch(this.config.analyticsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(metricsToSend),
      });

      if (!response.ok) {
        throw new Error(`Failed to send metrics: ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send performance metrics:', error);
    }
  }

  private prepareMetricsForSending(): PerformanceMetrics {
    // Update watch time with simplified tracking first
    if (this.isPlaying && this.currentWatchStartTime > 0) {
      const watchDuration = (Date.now() - this.currentWatchStartTime) / 1000;
      this.totalDurationWatched += watchDuration;
      // Reset start time to now for continuous tracking
      this.currentWatchStartTime = Date.now();
    }

    // Also update from Map for backwards compatibility
    this.updateWatchTime();

    return {
      ...this.metrics,
      errorTypes: Object.fromEntries(this.metrics.errorTypes as Map<string, number>),
    };
  }

  public getMetrics(): PerformanceMetrics {
    // Update watch time with simplified tracking first
    if (this.isPlaying && this.currentWatchStartTime > 0) {
      const watchDuration = (Date.now() - this.currentWatchStartTime) / 1000;
      const tempDuration = this.totalDurationWatched + watchDuration;
      // Don't reset start time here since we're just reading metrics
      this.metrics.watchTime = tempDuration;
      this.metrics.engagementRate = tempDuration / (this.videoElement.duration || 1);
    } else {
      // Also update from Map for backwards compatibility
      this.updateWatchTime();
    }

    return {
      ...this.metrics,
      errorTypes: Object.fromEntries(this.metrics.errorTypes as Map<string, number>),
    };
  }

  public destroy(): void {
    // Clear all timers
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Final watch time update with simplified tracking
    if (this.currentWatchStartTime > 0) {
      const watchDuration = (Date.now() - this.currentWatchStartTime) / 1000;
      this.totalDurationWatched += watchDuration;
      this.currentWatchStartTime = 0;
    }

    // Update watch time from Map
    this.updateWatchTime();

    // Send final metrics
    this.sendMetrics();

    // Clear the Map to free memory
    this.watchStartTimes.clear();

    // Remove all event listeners
    this.videoElement.removeEventListener('loadstart', this.handleLoadStart);
    this.videoElement.removeEventListener('loadeddata', this.handleLoadedData);
    this.videoElement.removeEventListener('canplay', this.handleCanPlay);
    this.videoElement.removeEventListener('play', this.handlePlay);
    this.videoElement.removeEventListener('pause', this.handlePause);
    this.videoElement.removeEventListener('waiting', this.handleWaiting);
    this.videoElement.removeEventListener('playing', this.handlePlaying);
    this.videoElement.removeEventListener('ended', this.handleEnded);
    this.videoElement.removeEventListener('error', this.handleError);
    this.videoElement.removeEventListener('timeupdate', this.handleTimeUpdate);
  }
}

export type { PerformanceMetrics, PerformanceConfig };
