/**
 * Video Analytics Event Types and Interfaces
 * Re-exports shared types for video analytics
 */

// Re-export value types (enums)
export { VideoEventType } from '@al-ummah/shared-types';

// Re-export pure types (interfaces)
export type {
  AnalyticsEvent,
  AnalyticsConfig,
  AnalyticsBatch,
  VideoError,
  VideoAnalyticsData,
  ChannelAnalyticsData,
  AnalyticsMetrics,
  AnalyticsSummaryData,
  AnalyticsQueryParams,
  TrendingContent,
} from '@al-ummah/shared-types';
