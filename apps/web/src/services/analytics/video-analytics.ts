import { logger } from '@/lib/logger-client';
/**
 * Video Analytics Service
 *
 * Tracks video playback events with:
 * - Event queueing and batch sending
 * - Automatic flush on timer and page unload
 * - LocalStorage backup for offline scenarios
 * - Non-blocking implementation (never blocks video playback)
 *
 * Phase 1.5: Basic events (ready, play, pause, ended, error)
 * Phase 3: Advanced events (seek, timeupdate, quality changes, etc.)
 */

import {
  AnalyticsEvent,
  AnalyticsConfig,
  AnalyticsBatch,
  VideoEventType,
  VideoError
} from './types';

/**
 * Main VideoAnalytics class for tracking video events
 */
export class VideoAnalytics {
  private videoId: string;
  private sessionId: string;
  private startTime: number;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval?: ReturnType<typeof setInterval>;
  private config: AnalyticsConfig;
  private unloadHandler?: () => void;
  private visibilityHandler?: () => void;
  private pendingFlushes: Promise<void>[] = [];

  // Phase 3: Quartile tracking state (prevent duplicate events)
  private quartilesFired = new Set<25 | 50 | 75>();

  // Phase 3: Buffering state tracking
  private bufferStartTime?: number;

  constructor(
    videoId: string,
    _userId?: string,
    config?: Partial<AnalyticsConfig>
  ) {
    this.videoId = videoId;
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();

    this.config = {
      endpoint: '/api/analytics/video',
      batchSize: 20,
      flushInterval: 30000, // 30 seconds
      enableDebugLogging: process.env.NODE_ENV === 'development',
      ...config
    };

    this.startFlushTimer();
    this.setupUnloadHandler();
  }

  /**
   * Track video player ready event
   */
  trackReady(): void {
    this.addEvent({
      eventType: VideoEventType.READY,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track play event
   */
  trackPlay(): void {
    this.addEvent({
      eventType: VideoEventType.PLAY,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track pause event
   */
  trackPause(): void {
    this.addEvent({
      eventType: VideoEventType.PAUSE,
      relativeTime: Date.now() - this.startTime
    });
  }

  /**
   * Track video ended event
   */
  trackComplete(): void {
    this.addEvent({
      eventType: VideoEventType.ENDED,
      relativeTime: Date.now() - this.startTime,
      data: {
        totalWatchTime: Date.now() - this.startTime
      }
    });

    // Flush immediately on completion
    void this.flush();
  }

  /**
   * Track error event
   */
  trackError(error: VideoError): void {
    this.addEvent({
      eventType: VideoEventType.ERROR,
      relativeTime: Date.now() - this.startTime,
      data: {
        code: error?.code,
        message: error?.message,
        type: error?.type
      }
    });

    // Flush errors immediately
    void this.flush();
  }

  /**
   * Track playback speed change event
   * Phase 2.2: Playback Speed Control
   */
  trackSpeedChange(rate: number, previousRate: number): void {
    this.addEvent({
      eventType: VideoEventType.SPEED_CHANGE,
      relativeTime: Date.now() - this.startTime,
      data: {
        rate,
        previousRate,
        change: rate - previousRate
      }
    });
  }

  /**
   * Track fullscreen change event
   * Phase 2.6: Fullscreen and Picture-in-Picture
   */
  trackFullscreenChange(isFullscreen: boolean): void {
    this.addEvent({
      eventType: isFullscreen ? VideoEventType.FULLSCREEN_ENTER : VideoEventType.FULLSCREEN_EXIT,
      relativeTime: Date.now() - this.startTime,
      data: {
        isFullscreen
      }
    });
  }

  /**
   * Track Picture-in-Picture change event
   * Phase 2.6: Fullscreen and Picture-in-Picture
   */
  trackPictureInPicture(isActive: boolean): void {
    this.addEvent({
      eventType: isActive ? VideoEventType.PIP_ENTER : VideoEventType.PIP_EXIT,
      relativeTime: Date.now() - this.startTime,
      data: {
        isActive
      }
    });
  }

  // ==================== Phase 3: Advanced Analytics ====================

  /**
   * Track seek event when user jumps to different position
   * Phase 3: Advanced Analytics
   *
   * @param fromTime - Previous playback position in seconds
   * @param toTime - New playback position in seconds
   *
   * @example
   * ```typescript
   * player.on('seeked', () => {
   *   analytics.trackSeek(previousTime, currentTime);
   * });
   * ```
   */
  trackSeek(fromTime: number, toTime: number): void {
    this.addEvent({
      eventType: VideoEventType.SEEK,
      relativeTime: Date.now() - this.startTime,
      data: {
        fromTime,
        toTime,
        seekDistance: toTime - fromTime,
        isForward: toTime > fromTime
      }
    });
  }

  /**
   * Track playback progress at intervals
   * Phase 3: Advanced Analytics
   *
   * IMPORTANT: This method should be called from a throttled/debounced handler
   * to avoid tracking every single timeupdate event (which fires ~4x per second).
   *
   * Recommended throttle interval: 5-10 seconds for progress tracking
   *
   * @param currentTime - Current playback position in seconds
   * @param duration - Total video duration in seconds
   * @param percentage - Playback progress as percentage (0-100)
   *
   * @example
   * ```typescript
   * // Option 1: Using lodash throttle (recommended)
   * import { throttle } from 'lodash';
   *
   * const throttledTrackProgress = throttle(
   *   (time, duration) => {
   *     const percentage = (time / duration) * 100;
   *     analytics.trackProgress(time, duration, percentage);
   *   },
   *   5000  // Track every 5 seconds
   * );
   *
   * player.on('timeupdate', () => {
   *   throttledTrackProgress(player.currentTime(), player.duration());
   * });
   *
   * // Option 2: Manual throttling with timestamp check
   * let lastProgressTrack = 0;
   * const PROGRESS_INTERVAL = 5000; // 5 seconds
   *
   * player.on('timeupdate', () => {
   *   const now = Date.now();
   *   if (now - lastProgressTrack >= PROGRESS_INTERVAL) {
   *     const time = player.currentTime();
   *     const duration = player.duration();
   *     analytics.trackProgress(time, duration, (time / duration) * 100);
   *     lastProgressTrack = now;
   *   }
   * });
   * ```
   */
  trackProgress(currentTime: number, duration: number, percentage: number): void {
    this.addEvent({
      eventType: VideoEventType.TIMEUPDATE,
      relativeTime: Date.now() - this.startTime,
      data: {
        currentTime,
        duration,
        percentage: Math.min(100, Math.max(0, percentage)), // Clamp 0-100
        remainingTime: duration - currentTime
      }
    });
  }

  /**
   * Track video quality change event
   * Phase 3: Advanced Analytics
   *
   * @param fromQuality - Previous quality level (e.g., "720p", "auto")
   * @param toQuality - New quality level (e.g., "1080p", "auto")
   *
   * @example
   * ```typescript
   * player.qualityLevels().on('change', () => {
   *   const currentQuality = player.qualityLevels()[player.qualityLevels().selectedIndex];
   *   analytics.trackQualityChange(previousQuality, currentQuality.height + 'p');
   * });
   * ```
   */
  trackQualityChange(fromQuality: string, toQuality: string): void {
    this.addEvent({
      eventType: VideoEventType.QUALITY_CHANGE,
      relativeTime: Date.now() - this.startTime,
      data: {
        fromQuality,
        toQuality,
        isUpgrade: this.compareQuality(fromQuality, toQuality) > 0,
        isAutomatic: toQuality === 'auto' || fromQuality === 'auto'
      }
    });
  }

  /**
   * Track buffering start event
   * Phase 3: Advanced Analytics
   *
   * Call this when the player starts buffering (waiting for data).
   * Must be paired with trackBufferEnd() to measure buffering duration.
   *
   * @example
   * ```typescript
   * player.on('waiting', () => {
   *   analytics.trackBufferStart();
   * });
   * ```
   */
  trackBufferStart(): void {
    this.bufferStartTime = Date.now();

    this.addEvent({
      eventType: VideoEventType.BUFFER_START,
      relativeTime: Date.now() - this.startTime,
      data: {
        timestamp: this.bufferStartTime
      }
    });
  }

  /**
   * Track buffering end event
   * Phase 3: Advanced Analytics
   *
   * Call this when the player finishes buffering and resumes playback.
   * Automatically calculates buffering duration if trackBufferStart() was called.
   *
   * @param duration - Optional buffering duration in milliseconds (if not using trackBufferStart)
   *
   * @example
   * ```typescript
   * // Option 1: Automatic duration calculation (recommended)
   * player.on('waiting', () => analytics.trackBufferStart());
   * player.on('canplay', () => analytics.trackBufferEnd());
   *
   * // Option 2: Manual duration tracking
   * player.on('canplay', () => {
   *   const duration = Date.now() - bufferStartTime;
   *   analytics.trackBufferEnd(duration);
   * });
   * ```
   */
  trackBufferEnd(duration?: number): void {
    const bufferDuration = duration ?? (
      this.bufferStartTime
        ? Date.now() - this.bufferStartTime
        : 0
    );

    this.addEvent({
      eventType: VideoEventType.BUFFER_END,
      relativeTime: Date.now() - this.startTime,
      data: {
        duration: bufferDuration,
        durationSeconds: bufferDuration / 1000
      }
    });

    // Reset buffer tracking
    this.bufferStartTime = undefined;
  }

  /**
   * Track quartile milestone (25%, 50%, 75% completion)
   * Phase 3: Advanced Analytics
   *
   * This method ensures each quartile is only tracked once per session.
   * Quartiles are commonly used for video engagement metrics and advertising.
   *
   * @param quartile - Which quartile was reached (25, 50, or 75)
   *
   * @example
   * ```typescript
   * player.on('timeupdate', () => {
   *   const percentage = (player.currentTime() / player.duration()) * 100;
   *
   *   if (percentage >= 25 && percentage < 50) {
   *     analytics.trackQuartile(25);
   *   } else if (percentage >= 50 && percentage < 75) {
   *     analytics.trackQuartile(50);
   *   } else if (percentage >= 75 && percentage < 100) {
   *     analytics.trackQuartile(75);
   *   }
   * });
   * ```
   */
  trackQuartile(quartile: 25 | 50 | 75): void {
    // Only fire each quartile once per session
    if (this.quartilesFired.has(quartile)) {
      if (this.config.enableDebugLogging) {
        logger.debug(`[VideoAnalytics] Quartile ${quartile}% already tracked, skipping`);
      }
      return;
    }

    this.quartilesFired.add(quartile);

    // Map quartile to specific event type
    const eventTypeMap = {
      25: VideoEventType.QUARTILE_25,
      50: VideoEventType.QUARTILE_50,
      75: VideoEventType.QUARTILE_75
    };

    this.addEvent({
      eventType: eventTypeMap[quartile],
      relativeTime: Date.now() - this.startTime,
      data: {
        quartile,
        percentage: quartile
      }
    });
  }

  /**
   * Helper method to compare quality levels
   * Returns positive if toQuality > fromQuality (upgrade)
   * Returns negative if toQuality < fromQuality (downgrade)
   * Returns 0 if equal or incomparable
   */
  private compareQuality(fromQuality: string, toQuality: string): number {
    // Extract numeric resolution from quality strings (e.g., "1080p" -> 1080)
    const extractResolution = (quality: string): number => {
      if (quality === 'auto') return -1; // Special handling for auto
      const match = quality.match(/(\d+)p?/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const fromRes = extractResolution(fromQuality);
    const toRes = extractResolution(toQuality);

    return toRes - fromRes;
  }

  /**
   * Add event to queue
   */
  private addEvent(event: Partial<AnalyticsEvent>): void {
    const fullEvent: AnalyticsEvent = {
      videoId: this.videoId,
      
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      relativeTime: Date.now() - this.startTime,
      eventType: event.eventType as VideoEventType,
      ...event
    };

    this.eventQueue.push(fullEvent);

    if (this.config.enableDebugLogging) {
      logger.debug(`[VideoAnalytics] ${fullEvent.eventType}`, fullEvent);
    }

    // Flush if queue is full
    if (this.eventQueue.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flush events to server
   */
  private async flush(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Create a holder object to store the promise reference
    // This allows the finally block to reference the promise for cleanup
    const promiseHolder: { promise?: Promise<void> } = {};

    const flushPromise = (async () => {
      try {
        const batch: AnalyticsBatch = { events };

        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(batch),
          keepalive: true  // Important for beforeunload
        });

        if (!response.ok) {
          throw new Error(`Analytics flush failed: ${response.status}`);
        }

        if (this.config.enableDebugLogging) {
          logger.debug(`[VideoAnalytics] Flushed ${events.length} events`);
        }
      } catch (error) {
        logger.error('[VideoAnalytics] Failed to send events:', error);

        // Re-add events to queue on failure
        this.eventQueue.unshift(...events);

        // Store in localStorage as backup
        this.storeEventsLocally(events);
      } finally {
        // Remove by reference instead of index to avoid race conditions
        if (promiseHolder.promise) {
          const index = this.pendingFlushes.indexOf(promiseHolder.promise);
          if (index > -1) {
            this.pendingFlushes.splice(index, 1);
          }
        }
      }
    })();

    promiseHolder.promise = flushPromise;
    this.pendingFlushes.push(flushPromise);
    return flushPromise;
  }

  /**
   * Store events in localStorage as backup
   */
  private storeEventsLocally(events: AnalyticsEvent[]): void {
    try {
      const stored = localStorage.getItem('pendingVideoAnalytics') || '[]';

      // Safely parse JSON with validation
      let pending: AnalyticsEvent[];
      try {
        const parsed = JSON.parse(stored);
        pending = Array.isArray(parsed) ? parsed : [];
      } catch (parseError) {
        // If parsing fails or result isn't an array, start fresh
        logger.warn('[VideoAnalytics] Failed to parse pendingVideoAnalytics from localStorage. Data may be corrupted and will be reset.', parseError);
        pending = [];
      }

      // Limit stored events to prevent quota exhaustion (5-10MB typical limit)
      const MAX_STORED_EVENTS = 1000; // ~100-200KB depending on event size
      const combined = [...pending, ...events];
      const limited = combined.slice(-MAX_STORED_EVENTS); // Keep only most recent

      try {
        localStorage.setItem(
          'pendingVideoAnalytics',
          JSON.stringify(limited)
        );

        if (this.config.enableDebugLogging) {
          logger.debug(`[VideoAnalytics] Stored ${events.length} events locally`);
          if (combined.length > MAX_STORED_EVENTS) {
            logger.warn(`[VideoAnalytics] Dropped ${combined.length - MAX_STORED_EVENTS} old events`);
          }
        }
      } catch (storageError) {
        // Handle quota exceeded error gracefully
        if (storageError instanceof DOMException && storageError.name === 'QuotaExceededError') {
          logger.warn('[VideoAnalytics] localStorage quota exceeded, clearing old events');
          localStorage.removeItem('pendingVideoAnalytics');
          // Try storing just the new events
          try {
            localStorage.setItem('pendingVideoAnalytics', JSON.stringify(events));
          } catch {
            // If still fails, give up gracefully
            logger.error('[VideoAnalytics] Cannot store events, quota exceeded');
          }
        } else {
          throw storageError; // Re-throw other storage errors
        }
      }
    } catch (error) {
      logger.error('[VideoAnalytics] Failed to store events locally:', error);
    }
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => {
      void this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Setup handler to flush on page unload and visibility change
   */
  private setupUnloadHandler(): void {
    // Flush on page unload
    this.unloadHandler = () => {
      void this.flush();
    };

    // Flush on visibility change (tab hidden)
    this.visibilityHandler = () => {
      if (document.hidden) {
        void this.flush();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.unloadHandler);
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Generate unique session ID using crypto.getRandomValues()
   * for better entropy than Math.random()
   */
  private generateSessionId(): string {
    const timestamp = Date.now();

    // Hex encoding (base16): 6 bytes → 12 hex chars
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const randomBytes = new Uint8Array(6);
      window.crypto.getRandomValues(randomBytes);
      const random = Array.from(randomBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
      return `${timestamp}-${random}`;
    }

    // Fallback to Math.random for environments without crypto API
    const random = Math.random().toString(36).substring(2, 11);
    return `${timestamp}-${random}`;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Flush remaining events
    void this.flush();

    // Clear flush timer
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    // Remove event handlers
    if (typeof window !== 'undefined') {
      if (this.unloadHandler) {
        window.removeEventListener('beforeunload', this.unloadHandler);
        this.unloadHandler = undefined;
      }
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = undefined;
      }
    }

    // Phase 3: Reset tracking state
    this.quartilesFired.clear();
    this.bufferStartTime = undefined;
  }

  /**
   * Get current session ID (for testing/debugging)
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get current queue length (for testing/debugging)
   */
  getQueueLength(): number {
    return this.eventQueue.length;
  }

  /**
   * Wait for all pending flushes to complete (for testing)
   */
  async waitForPendingFlushes(): Promise<void> {
    await Promise.all(this.pendingFlushes);
  }
}

/**
 * Singleton factory for managing multiple analytics instances
 */
const activeAnalytics = new Map<string, VideoAnalytics>();

/**
 * Get or create VideoAnalytics instance
 */
export function getVideoAnalytics(
  videoId: string,
  userId?: string
): VideoAnalytics {
  const key = `${videoId}-${userId || 'anonymous'}`;

  if (!activeAnalytics.has(key)) {
    const analytics = new VideoAnalytics(videoId, userId);
    activeAnalytics.set(key, analytics);
  }

  return activeAnalytics.get(key)!;
}

/**
 * Destroy and remove analytics instance
 */
export function destroyVideoAnalytics(
  videoId: string,
  userId?: string
): void {
  const key = `${videoId}-${userId || 'anonymous'}`;

  if (activeAnalytics.has(key)) {
    const analytics = activeAnalytics.get(key)!;
    analytics.destroy();
    activeAnalytics.delete(key);
  }
}

/**
 * Clear all analytics instances
 */
export function clearAllAnalytics(): void {
  activeAnalytics.forEach(analytics => analytics.destroy());
  activeAnalytics.clear();
}
