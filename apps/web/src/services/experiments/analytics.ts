import { logger } from '@/lib/logger-client';
export interface ExperimentEvent {
  eventType: 'assignment' | 'conversion' | 'exposure';
  experimentId: string;
  variant: 'control' | 'treatment';
  userId: string;
  timestamp: number;
  conversionValue?: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

class ExperimentAnalytics {
  private eventQueue: ExperimentEvent[] = [];
  private isProcessing = false;
  private readonly BATCH_SIZE = 10;
  private readonly FLUSH_INTERVAL = 5000;

  constructor() {
    if (typeof window !== 'undefined') {
      setInterval(() => this.flush(), this.FLUSH_INTERVAL);
      window.addEventListener('beforeunload', () => this.flush(true));
    }
  }

  trackEvent(event: ExperimentEvent): void {
    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }

  private async flush(isSync = false): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) return;

    this.isProcessing = true;
    const eventsToSend = this.eventQueue.splice(0, this.BATCH_SIZE);

    try {
      const response = await this.sendEvents(eventsToSend, isSync);

      if (!response.success && response.error) {
        this.eventQueue.unshift(...eventsToSend);
        logger.error('Failed to send A/B test events:', response.error);
      }
    } catch (error) {
      this.eventQueue.unshift(...eventsToSend);
      logger.error('Network error sending A/B test events:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async sendEvents(events: ExperimentEvent[], isSync: boolean): Promise<AnalyticsResponse> {
    const endpoint = '/api/analytics/ab-test';

    const payload = {
      events,
      timestamp: Date.now(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined
    };

    // Get auth token from cookies (client-side)
    const { getAuthHeaders } = await import('@/lib/auth/client-token');
    const authHeaders = getAuthHeaders();

    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(payload)
    };

    if (isSync && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const success = navigator.sendBeacon(endpoint, blob);
      return { success };
    }

    try {
      const response = await fetch(endpoint, options);
      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`
        };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getExperimentResults(experimentId: string): Promise<unknown> {
    try {
      // Get auth token from cookies (client-side)
      const { getAuthHeaders } = await import('@/lib/auth/client-token');
      const authHeaders = getAuthHeaders();

      const response = await fetch(`/api/analytics/ab-test?experimentId=${experimentId}`, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      logger.error('Failed to fetch experiment results:', error);
      throw error;
    }
  }

  async getExperimentStatistics(experimentId: string): Promise<unknown> {
    try {
      // Get auth token from cookies (client-side)
      const { getAuthHeaders } = await import('@/lib/auth/client-token');
      const authHeaders = getAuthHeaders();

      const response = await fetch(`/api/analytics/ab-test/stats?experimentId=${experimentId}`, {
        headers: {
          ...authHeaders,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      logger.error('Failed to fetch experiment statistics:', error);
      throw error;
    }
  }
}

export const experimentAnalytics = new ExperimentAnalytics();

export function trackExperimentEvent(event: ExperimentEvent): void {
  experimentAnalytics.trackEvent(event);
}

export function trackExperimentAssignment(
  experimentId: string,
  variant: 'control' | 'treatment',
  userId: string,
  metadata?: Record<string, unknown>
): void {
  trackExperimentEvent({
    eventType: 'assignment',
    experimentId,
    variant,
    userId,
    timestamp: Date.now(),
    metadata
  });
}

export function trackExperimentConversion(
  experimentId: string,
  variant: 'control' | 'treatment',
  userId: string,
  conversionValue?: number,
  metadata?: Record<string, unknown>
): void {
  trackExperimentEvent({
    eventType: 'conversion',
    experimentId,
    variant,
    userId,
    timestamp: Date.now(),
    conversionValue,
    metadata
  });
}

export function trackExperimentExposure(
  experimentId: string,
  variant: 'control' | 'treatment',
  userId: string,
  metadata?: Record<string, unknown>
): void {
  trackExperimentEvent({
    eventType: 'exposure',
    experimentId,
    variant,
    userId,
    timestamp: Date.now(),
    metadata
  });
}
