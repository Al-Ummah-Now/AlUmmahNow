/**
 * API Request/Input Types
 * Additional request types not defined in domain-specific files
 *
 * Note: Basic CRUD request types are defined in their respective files:
 * - VideoCreateRequest, VideoUpdateRequest → video.ts
 * - ChannelCreateRequest, ChannelUpdateRequest → channel.ts
 * - PlaylistCreateRequest, PlaylistUpdateRequest → playlist.ts
 * - CommentCreateRequest, CommentUpdateRequest → comment.ts
 * - ProfileUpdateRequest → user.ts
 * - SubscriptionRequest → channel.ts
 */

// ============================================================================
// Profile Request Types (ProfileCreateRequest doesn't exist in user.ts)
// ============================================================================

export interface ProfileCreateRequest {
  email: string;
  userName?: string;
  displayName?: string;
  displayNameLocalized?: Record<string, string>;
  firstName?: string;
  lastName?: string;
  bio?: string;
  bioLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  timezone?: string;
  websiteUrl?: string;
  location?: string;
}

// ============================================================================
// Live Stream Request Types
// ============================================================================

export interface LiveStreamCreateRequest {
  title: string;
  description?: string;
  scheduledStartTime?: string;
  thumbnailUrl?: string;
  category?: string;
  tags?: string[];
  language?: 'en' | 'ar';
  isPrivate?: boolean;
  allowChat?: boolean;
  maxViewers?: number;
}

export interface LiveStreamUpdateRequest {
  title?: string;
  description?: string;
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
  thumbnailUrl?: string;
  category?: string;
  tags?: string[];
  isPrivate?: boolean;
  allowChat?: boolean;
}

export interface LiveStreamQueryParams {
  limit?: number;
  cursor?: string;
  status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
  channelId?: string;
}

// ============================================================================
// Search and Discovery Types
// ============================================================================

export interface SearchFilters {
  category?: string;
  language?: 'en' | 'ar' | 'all';
  dateFrom?: string;
  dateTo?: string;
  duration?: 'short' | 'medium' | 'long' | 'all';
  sortBy?: 'relevance' | 'date' | 'views' | 'likes';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchQueryParams {
  limit?: number;
  cursor?: string;
  channelId?: string;
  search?: string;
  query?: string;
  filters?: SearchFilters;
}

export interface SearchSuggestion {
  /** Text shown (and searched when there is no item to open) */
  text: string;
  type: 'query' | 'channel' | 'category' | 'video' | 'playlist';
  /** Id of the video, channel or playlist to open */
  id?: string;
  /** Video thumbnail, channel avatar or playlist cover */
  thumbnailUrl?: string;
  /** Secondary line: channel name for videos and playlists, @handle for channels */
  subtitle?: string;
  /** Channel @handle (channels only) */
  handle?: string;
  verified?: boolean;
  count?: number;
  metadata?: Record<string, unknown>;
}

export interface RecommendationRequest {
  userId?: string;
  videoId?: string;
  limit?: number;
  excludeWatched?: boolean;
  categories?: string[];
}

// ============================================================================
// Trending Content Types
// ============================================================================

export interface TrendingRequest {
  period?: 'hour' | 'day' | 'week' | 'month';
  category?: string;
  region?: string;
  limit?: number;
}
