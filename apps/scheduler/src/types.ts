import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';

export interface Env {
  VIDEOS: R2Bucket;
  SCHEDULED_VIDEOS: R2Bucket;
  QUEUE: Queue;
  SCHEDULER_LOCKS: KVNamespace;
  SCHEDULER_METRICS: KVNamespace;
  MAX_RETRIES: string;
  BATCH_SIZE: string;
  LOCK_TTL: string;
  WEBSOCKET_URL: string;
}

export interface BatchResult {
  successful: ScheduledVideoMetadata[];
  failed: FailedVideo[];
}

export interface FailedVideo {
  video: ScheduledVideoMetadata;
  error: Error;
}

export interface PublishEvent {
  type: 'SCHEDULED_PUBLISH_SUCCESS' | 'SCHEDULED_PUBLISH_FAILURE' | 'SCHEDULED_PUBLISH_RETRY';
  videoId: string;
  scheduledTime: string;
  publishedAt?: string;
  error?: string;
  retryCount?: number;
}

export interface HealthStatus {
  healthy: boolean;
  lastRun?: string;
  queueDepth: number;
  failureRate: number;
}

export interface Metrics {
  scheduledVideosCount: number;
  publishedToday: number;
  failedToday: number;
  averageDelay: number;
  queueDepth: number;
}
