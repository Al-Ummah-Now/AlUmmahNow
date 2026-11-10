/**
 * Scheduler Types
 * Re-exports shared types and defines scheduler-specific types
 */

import type { ScheduledVideoMetadata, PublishEvent } from '@al-ummah/shared-types';

// Re-export for convenience
export type { ScheduledVideoMetadata, PublishEvent };

// Cloudflare Worker environment bindings
export interface Env {
  VIDEOS: R2Bucket;
  SCHEDULED_VIDEOS: R2Bucket;
  QUEUE: Queue;
  SCHEDULER_LOCKS: KVNamespace;
  SCHEDULER_METRICS: KVNamespace;
  SCHEDULER_LOCK: DurableObjectNamespace;
  MAX_RETRIES: string;
  BATCH_SIZE: string;
  LOCK_TTL: string;
  WEBSOCKET_URL: string;
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
  /** admin-api error ingest (Errors page) */
  ERRORS_INGEST_URL?: string;
  ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string };
}

// Scheduler-specific types
export interface BatchResult {
  successful: ScheduledVideoMetadata[];
  failed: FailedVideo[];
}

export interface FailedVideo {
  video: ScheduledVideoMetadata;
  error: Error;
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
