import { logger } from '@/lib/logger-client';
import { onCLS, onINP, onFCP, onLCP, onTTFB, type Metric } from 'web-vitals';

interface WebVitalsConfig {
  analyticsEndpoint: string;
  enableAutoSend: boolean;
  sendToAnalytics?: (metric: Metric) => void;
}

interface EnhancedMetric extends Metric {
  userAgent: string;
  url: string;
  timestamp: number;
}

export class WebVitalsMonitor {
  private config: WebVitalsConfig;
  private metricsQueue: EnhancedMetric[] = [];

  constructor(config: Partial<WebVitalsConfig> = {}) {
    this.config = {
      analyticsEndpoint: '/api/analytics/performance',
      enableAutoSend: true,
      ...config
    };

    if (typeof window !== 'undefined') {
      this.initializeTracking();
    }
  }

  private initializeTracking(): void {
    onCLS(this.handleMetric.bind(this));
    onINP(this.handleMetric.bind(this));
    onFCP(this.handleMetric.bind(this));
    onLCP(this.handleMetric.bind(this));
    onTTFB(this.handleMetric.bind(this));
  }

  private handleMetric(metric: Metric): void {
    const enhancedMetric: EnhancedMetric = {
      ...metric,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: Date.now(),
    };

    if (this.config.sendToAnalytics) {
      this.config.sendToAnalytics(enhancedMetric);
    }

    if (this.config.enableAutoSend) {
      this.sendMetric(enhancedMetric);
    } else {
      this.metricsQueue.push(enhancedMetric);
    }
  }

  private async sendMetric(metric: EnhancedMetric): Promise<void> {
    try {
      const response = await fetch(this.config.analyticsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'web-vitals',
          data: metric,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send web vital: ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send web vital metric:', error);
      this.metricsQueue.push(metric);
    }
  }

  public async flushQueue(): Promise<void> {
    if (this.metricsQueue.length === 0) return;

    const metricsToSend = [...this.metricsQueue];
    this.metricsQueue = [];

    try {
      const response = await fetch(this.config.analyticsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'web-vitals-batch',
          data: metricsToSend,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send web vitals batch: ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send web vitals batch:', error);
      this.metricsQueue.unshift(...metricsToSend);
    }
  }

  public getQueuedMetrics(): EnhancedMetric[] {
    return [...this.metricsQueue];
  }
}

export type { WebVitalsConfig, EnhancedMetric };
