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