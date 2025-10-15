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
  private userId?: string;
  private sessionId: string;
  private startTime: number;
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval?: ReturnType<typeof setInterval>;
  private config: AnalyticsConfig;
  private unloadHandler?: () => void;
  private visibilityHandler?: () => void;
  private pendingFlushes: Promise<void>[] = [];

  constructor(
    videoId: string,
    userId?: string,
    config?: Partial<AnalyticsConfig>
  ) {
    this.videoId = videoId;
    this.userId = userId;
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
   * Add event to queue
   */
  private addEvent(event: Partial<AnalyticsEvent>): void {
    const fullEvent: AnalyticsEvent = {
      videoId: this.videoId,
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      relativeTime: Date.now() - this.startTime,
      eventType: event.eventType as VideoEventType,
      ...event
    };

    this.eventQueue.push(fullEvent);

    if (this.config.enableDebugLogging) {
      console.log('[VideoAnalytics]', fullEvent.eventType, fullEvent);
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
          console.log('[VideoAnalytics] Flushed', events.length, 'events');
        }
      } catch (error) {
        console.error('[VideoAnalytics] Failed to send events:', error);

        // Re-add events to queue on failure
        this.eventQueue.unshift(...events);

        // Store in localStorage as backup
        this.storeEventsLocally(events);
      } finally {
        // Remove by reference instead of index to avoid race conditions
        const index = this.pendingFlushes.indexOf(flushPromise);
        if (index > -1) {
          this.pendingFlushes.splice(index, 1);
        }
      }
    })();

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
      } catch {
        // If parsing fails or result isn't an array, start fresh
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
          console.log('[VideoAnalytics] Stored', events.length, 'events locally');
          if (combined.length > MAX_STORED_EVENTS) {
            console.warn('[VideoAnalytics] Dropped', combined.length - MAX_STORED_EVENTS, 'old events');
          }
        }
      } catch (storageError) {
        // Handle quota exceeded error gracefully
        if (storageError instanceof DOMException && storageError.name === 'QuotaExceededError') {
          console.warn('[VideoAnalytics] localStorage quota exceeded, clearing old events');
          localStorage.removeItem('pendingVideoAnalytics');
          // Try storing just the new events
          try {
            localStorage.setItem('pendingVideoAnalytics', JSON.stringify(events));
          } catch {
            // If still fails, give up gracefully
            console.error('[VideoAnalytics] Cannot store events, quota exceeded');
          }
        } else {
          throw storageError; // Re-throw other storage errors
        }
      }
    } catch (error) {
      console.error('[VideoAnalytics] Failed to store events locally:', error);
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

    // Use crypto.getRandomValues for better randomness
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const randomBytes = new Uint8Array(6);
      window.crypto.getRandomValues(randomBytes);
      const random = Array.from(randomBytes)
        .map(byte => byte.toString(36))
        .join('')
        .substring(0, 9);
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
