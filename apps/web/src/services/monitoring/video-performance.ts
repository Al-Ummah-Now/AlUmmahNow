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
  private watchStartTimes: Map<number, number> = new Map();
  private totalDurationWatched: number = 0;
  private isPlaying: boolean = false;
  private sendTimer: NodeJS.Timeout | null = null;

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
    this.watchStartTimes.set(Date.now(), this.videoElement.currentTime);
  }

  private handlePause(): void {
    this.isPlaying = false;
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
      const quality = (this.videoElement as any).getVideoPlaybackQuality();
      const totalBytes = quality.totalVideoFrames || 0;
      const totalFrames = quality.droppedVideoFrames || 1;
      return totalBytes > 0 ? (totalBytes * 8) / (totalFrames * 0.033) : 0;
    }
    return 0;
  }

  private getCurrentQuality(): string {
    if ('webkitVideoDecodedByteCount' in this.videoElement) {
      const bytes = (this.videoElement as any).webkitVideoDecodedByteCount;
      return bytes > 1000000 ? 'high' : bytes > 500000 ? 'medium' : 'low';
    }
    return 'unknown';
  }

  private updateWatchTime(): void {
    for (const [startTime] of this.watchStartTimes) {
      const watchDuration = (Date.now() - startTime) / 1000;
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

  public async sendMetrics(): Promise<void> {
    try {
      const metricsToSend = this.prepareMetricsForSending();
      const response = await fetch(this.config.analyticsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metricsToSend),
      });

      if (!response.ok) {
        throw new Error(`Failed to send metrics: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send performance metrics:', error);
    }
  }

  private prepareMetricsForSending(): PerformanceMetrics {
    this.updateWatchTime();
    return {
      ...this.metrics,
      errorTypes: Object.fromEntries(this.metrics.errorTypes as Map<string, number>),
    };
  }

  public getMetrics(): PerformanceMetrics {
    this.updateWatchTime();
    return {
      ...this.metrics,
      errorTypes: Object.fromEntries(this.metrics.errorTypes as Map<string, number>),
    };
  }

  public destroy(): void {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }
    this.updateWatchTime();
    this.sendMetrics();

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
