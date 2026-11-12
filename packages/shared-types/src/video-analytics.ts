import type { ViewTrafficSource } from './analytics-collection';

/**
 * Video Analytics Types
 * Shared analytics event types and data structures
 */

/**
 * All supported video event types for analytics
 */
export enum VideoEventType {
  // Phase 1: Basic events
  READY = 'ready',
  PLAY = 'play',
  PAUSE = 'pause',
  ENDED = 'ended',
  ERROR = 'error',

  // Phase 2: Playback controls
  SPEED_CHANGE = 'speed_change',
  VOLUME_CHANGE = 'volume_change',
  MUTE = 'mute',
  UNMUTE = 'unmute',

  // Phase 2: Fullscreen and Picture-in-Picture
  FULLSCREEN_ENTER = 'fullscreen_enter',
  FULLSCREEN_EXIT = 'fullscreen_exit',
  PIP_ENTER = 'pip_enter',
  PIP_EXIT = 'pip_exit',

  // Phase 3: Advanced events
  SEEK = 'seek',
  TIMEUPDATE = 'timeupdate',
  QUALITY_CHANGE = 'quality_change',
  BUFFER_START = 'buffer_start',
  BUFFER_END = 'buffer_end',
  QUARTILE_25 = 'quartile_25',
  QUARTILE_50 = 'quartile_50',
  QUARTILE_75 = 'quartile_75',

  // #235: played seconds since the previous report (data: { seconds })
  WATCH_TIME = 'watch_time',
  RETENTION = 'retention',

  // Loading milestones (#79)
  LOAD_START = 'loadstart',
  LOADED_METADATA = 'loadedmetadata',
}

/**
 * Core analytics event structure
 */
export interface AnalyticsEvent {
  videoId: string;
  userId?: string;
  channelId?: string;
  sessionId: string;
  eventType: VideoEventType;
  timestamp: string; // ISO 8601 format
  relativeTime: number; // milliseconds since player init
  data?: Record<string, unknown>;
}

/**
 * Configuration options for video analytics
 */
export interface AnalyticsConfig {
  endpoint: string;
  batchSize: number;
  flushInterval: number; // milliseconds
  enableDebugLogging?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
  /** Where the player runs; sent with every batch (docs/embeds §6) */
  context?: AnalyticsContext;
}

/**
 * Playback surface of a batch. `embed` = the iframe player on another page;
 * `embedOrigin` is that page's origin (never its path). Absent = watch page.
 */
export interface AnalyticsContext {
  source: 'watch' | 'embed';
  embedOrigin?: string | null;
  /** Where the view came from. Only sent with analytics consent. */
  trafficSource?: ViewTrafficSource;
  /** External views only: the referring site's host */
  referrerHost?: string;
  /**
   * The player started this video on its own (an up-next or playlist advance), not the viewer.
   * Counted apart so creator analytics stay honest (docs/specs/PLAYLIST-PLAYBACK.md).
   */
  autoplay?: boolean;
}

/**
 * Batch of events sent to server
 */
export interface AnalyticsBatch {
  events: AnalyticsEvent[];
  context?: AnalyticsContext;
  batchId?: string;
  sentAt?: string;
}

/**
 * Video error data structure
 */
export interface VideoError {
  code?: string | number;
  message?: string;
  type?: string;
  fatal?: boolean;
}

/**
 * Individual video analytics data
 */
export interface VideoAnalyticsData {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  watchTime: number; // in seconds
  avgViewDuration: number; // in seconds
  clickThroughRate: number; // percentage
  engagementRate: number; // percentage
  dateCreated: string;
  thumbnailUrl?: string;
}

/**
 * Channel analytics data
 */
export interface ChannelAnalyticsData {
  channelId: string;
  channelName?: string;
  totalViews: number;
  totalVideos: number;
  totalSubscribers: number;
  totalLikes: number;
  totalComments: number;
  avgViewsPerVideo: number;
  avgEngagementRate: number;
  topPerformingVideos: VideoAnalyticsData[];
  recentMetrics: AnalyticsMetrics[];
}

/**
 * Time-series analytics metrics
 */
export interface AnalyticsMetrics {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers: number;
  watchTime: number;
}

/**
 * Analytics summary for dashboard
 */
export interface AnalyticsSummaryData {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSubscribers: number;
  totalVideos: number;
  avgViewsPerVideo: number;
  engagementRate: number;
  topVideo: VideoAnalyticsData | null;
}

/**
 * Analytics query parameters
 */
export interface AnalyticsQueryParams {
  limit?: number;
  cursor?: string;
  dateFrom?: string; // ISO date string
  dateTo?: string; // ISO date string
  videoId?: string;
  channelId?: string;
  metric?: 'views' | 'likes' | 'comments' | 'shares' | 'watch_time' | 'engagement_rate';
}

/**
 * Trending content response
 */
export interface TrendingContent<T = unknown> {
  videos: T[];
  period: 'hour' | 'day' | 'week' | 'month';
  category?: string;
  region?: string;
}
