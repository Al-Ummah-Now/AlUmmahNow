/**
 * Video Analytics Event Types and Interfaces
 *
 * Phase 1.5: Basic event tracking
 * Phase 3: Advanced event tracking (types defined, implementation pending)
 */

/**
 * All supported video event types
 */
export enum VideoEventType {
  // Phase 1: Basic events (implemented)
  READY = 'ready',
  PLAY = 'play',
  PAUSE = 'pause',
  ENDED = 'ended',
  ERROR = 'error',

  // Phase 3: Advanced events (defined now, implemented later)
  SEEK = 'seek',
  TIMEUPDATE = 'timeupdate',
  QUALITY_CHANGE = 'quality_change',
  BUFFER_START = 'buffer_start',
  BUFFER_END = 'buffer_end',
  QUARTILE_25 = 'quartile_25',
  QUARTILE_50 = 'quartile_50',
  QUARTILE_75 = 'quartile_75'
}

/**
 * Core analytics event structure
 */
export interface AnalyticsEvent {
  videoId: string;
  userId?: string;
  sessionId: string;
  eventType: VideoEventType;
  timestamp: string;       // ISO 8601 format
  relativeTime: number;    // milliseconds since player init
  data?: Record<string, any>;
}

/**
 * Configuration options for VideoAnalytics
 */
export interface AnalyticsConfig {
  endpoint: string;
  batchSize: number;
  flushInterval: number;  // milliseconds
  enableDebugLogging?: boolean;
}

/**
 * Batch of events sent to server
 */
export interface AnalyticsBatch {
  events: AnalyticsEvent[];
}

/**
 * Error data structure
 */
export interface VideoError {
  code?: string | number;
  message?: string;
  type?: string;
}
