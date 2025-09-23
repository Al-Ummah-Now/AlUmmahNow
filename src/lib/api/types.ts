// API Response Types based on OpenAPI specification

export interface ApiResponse<T> {
  success: boolean;
  result?: T;
  error?: string;
  message?: string;
}

export interface PaginationResponse<T> {
  cursor: string;
  limit: number;
  data: T[];
}

export interface PaginationMeta {
  limit: number;
  cursor?: string;
  hasMore: boolean;
}

// Video Types
export interface VideoCreateRequest {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  width?: number;
  height?: number;
  availableResolutions?: string[];
  isPublic?: boolean;
  isLive?: boolean;
}

export interface VideoUpdateRequest {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  width?: number;
  height?: number;
  availableResolutions?: string[];
  isPublic?: boolean;
  isLive?: boolean;
}

// Profile Types
export interface ProfileCreateRequest {
  email: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
}

export interface ProfileUpdateRequest {
  email?: string;
  userName?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  coverUrl?: string;
}

// Playlist Types
export interface PlaylistCreateRequest {
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videos?: string[];
  isPublic?: boolean;
}

export interface PlaylistUpdateRequest {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  isPublic?: boolean;
}

export interface PlaylistAddVideoRequest {
  videoId: string;
}

// Channel Types
export interface ChannelCreateRequest {
  name: string;
  isMain?: boolean;
  avatarUrl?: string;
  coverUrl?: string;
}

// Comment Types
export interface CommentCreateRequest {
  text: string;
}

export interface CommentUpdateRequest {
  text: string;
}

// API Headers
export interface ApiHeaders {
  channelId?: string;
  userId?: string;
}

// Query Parameters
export interface ListQueryParams {
  limit?: number;
  cursor?: string;
}

// Additional request types not defined in OpenAPI but needed for implementation
export interface ChannelUpdateRequest {
  name?: string;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

export interface SubscriptionRequest {
  notificationsEnabled?: boolean;
}

// Analytics Types
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

export interface ChannelAnalyticsData {
  channelId: string;
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

export interface AnalyticsMetrics {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers: number;
  watchTime: number;
}

export interface AnalyticsSummary {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalSubscribers: number;
  totalVideos: number;
  avgViewsPerVideo: number;
  engagementRate: number;
  topVideo: VideoAnalyticsData | null;
}

export interface AnalyticsQueryParams extends ListQueryParams {
  dateFrom?: string; // ISO date string
  dateTo?: string; // ISO date string
  videoId?: string;
  channelId?: string;
}