/**
 * API Types for Web App
 * Re-exports shared types and adds web-specific extensions
 */

// Re-export all shared types (using export type for isolatedModules compatibility)
export type {
  // Response types
  ApiResponse,
  PaginatedResponse,
  PaginationMeta,
  ResponseError,
  ListQueryParams,
  ApiHeaders,
  // Profile
  ProfileCreateRequest,
  ProfileUpdateRequest,
  // Video
  VideoCreateRequest,
  VideoUpdateRequest,
  // Channel
  ChannelCreateRequest,
  ChannelUpdateRequest,
  SubscriptionRequest,
  // Playlist
  PlaylistCreateRequest,
  PlaylistUpdateRequest,
  PlaylistAddVideoRequest,
  // Comment
  CommentCreateRequest,
  CommentUpdateRequest,
  // Live Stream
  LiveStreamCreateRequest,
  LiveStreamUpdateRequest,
  LiveStreamQueryParams,
  // Search
  SearchFilters,
  SearchQueryParams,
  SearchSuggestion,
  RecommendationRequest,
  TrendingRequest,
  // Analytics
  VideoAnalyticsData,
  ChannelAnalyticsData,
  AnalyticsMetrics,
  AnalyticsSummaryData,
  AnalyticsQueryParams,
  TrendingContent,
} from '@al-ummah/shared-types';

// Type alias for backwards compatibility
export type { PaginatedResponse as PaginationResponse } from '@al-ummah/shared-types';
export type { AnalyticsSummaryData as AnalyticsSummary } from '@al-ummah/shared-types';
