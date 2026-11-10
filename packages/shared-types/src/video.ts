/**
 * Video-related types
 * These types are shared between frontend and backend
 */

import { Timestamps, SoftDelete, Moderation } from './common';
import { SubtitleTrack } from './subtitle';
import { VideoCategory } from './upload-defaults';

// Re-export VideoCategory for convenience
export { VideoCategory };

export interface VideoChapter {
  id: string;           // UUID for chapter
  startTime: number;    // Start time in seconds
  endTime: number;      // End time in seconds
  title: string;        // Chapter title
  titleLocalized?: {    // Localized titles (optional)
    en?: string;
    ar?: string;
  };
}

export interface VideoChapterData {
  chapters: VideoChapter[];
  source: 'automatic' | 'manual' | 'imported';
  parsedAt: string;     // ISO timestamp
  version: number;      // For future migration
}

export interface VideoObject extends Timestamps, SoftDelete, Moderation {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>; // Multi-language titles
  description: string | null;
  descriptionLocalized?: Record<string, string>; // Multi-language descriptions
  thumbnailUrl: string;
  /** Upload processing state; absent on older videos (treated as ready) */
  uploadStatus?: 'initiated' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
  thumbnailType?: 'auto' | 'custom'; // Type of thumbnail (auto-generated or custom)
  thumbnailSizes?: {
    hd?: string;    // 1280x720
    sd?: string;    // 640x360
    mobile?: string; // 320x180
    thumb?: string;  // 120x90
  };
  videoUrl: string;
  playUrl?: string; // HLS streaming URL (e.g., https://vz-xxx.b-cdn.net/{videoGuid}/playlist.m3u8)
  userId: string;
  channelId: string | null;
  channel: string;
  channelName: string;
  channelAvatarUrl: string;
  channelCoverUrl?: string; // Channel cover/banner image

  // Video metadata
  duration?: number;
  width?: number;
  height?: number;
  availableResolutions?: string[];
  format?: string;
  fileSize?: number;

  // Engagement metrics
  views?: number;
  likesCount: number;
  dislikesCount: number;
  commentsCount: number;
  sharesCount?: number;
  /** Per-video comment settings (Story 29.2): on | held (for review) | off */
  commentSettings?: VideoCommentSettings;

  // Status and visibility
  isPublic?: boolean;
  isLive?: boolean;
  isFeatured?: boolean;
  processingStatus?: VideoProcessingStatus;

  // SEO and categorization
  tags?: string[];
  category?: VideoCategory;
  language?: string;

  // Chapter support
  chapters?: VideoChapterData;
  hasChapters?: boolean;  // Quick check flag

  // Subtitle support
  subtitles?: SubtitleTrack[];
  hasSubtitles?: boolean; // Quick check flag
  subtitleLanguages?: string[]; // Quick lookup: ['en', 'ar', 'ur']

  // Timestamps
  dateCreated: string;
  dateModified: string;
  publishedAt?: string;

  // Scheduling fields
  scheduledPublishDate?: string;        // ISO 8601 datetime in UTC
  scheduledPublishTimezone?: string;    // IANA timezone (e.g., 'America/New_York')
  scheduledPublishStatus?: ScheduledPublishStatus;
  scheduledBy?: string;                 // User ID who scheduled
  scheduledAt?: string;                 // When it was scheduled
  publishedViaSchedule?: boolean;       // True if published via scheduler

  // Premiere fields (future enhancement)
  isPremiered?: boolean;
  premiereDate?: string;
  premiereCountdownStarted?: boolean;
}

export type ScheduledPublishStatus =
  | 'scheduled'      // Waiting to be published
  | 'publishing'     // Currently being published
  | 'published'      // Successfully published
  | 'failed'         // Failed to publish
  | 'cancelled';     // User cancelled the schedule

export type VideoProcessingStatus =
  | 'pending'
  | 'processing'
  | 'transcoding'
  | 'completed'
  | 'failed'
  | 'archived';

export interface VideoCreateRequest {
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  channelId?: string;
  thumbnailUrl?: string;
  videoUrl: string;
  isPublic?: boolean;
  tags?: string[];
  category?: VideoCategory;
  language?: string;
}

export interface VideoUpdateRequest {
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  thumbnailUrl?: string;
  isPublic?: boolean;
  tags?: string[];
  category?: VideoCategory;
  language?: string;
  commentSettings?: VideoCommentSettings;
}

/** Comments on a video: on, held for the owner's review, or off */
export type VideoCommentSettings = 'on' | 'held' | 'off';

/**
 * Duration filter for video search
 * - 'all': No duration filtering
 * - 'short': Videos <= 180 seconds
 * - 'standard': Videos > 180 seconds and not live
 * - 'live': Live stream videos
 */
export type VideoDurationFilter = 'all' | 'short' | 'standard' | 'live';

/**
 * Schedule filter for video search
 * - 'all': All videos (scheduled and published)
 * - 'scheduled': Only scheduled videos (not yet published)
 * - 'published': Only published videos
 */
export type VideoScheduleFilter = 'all' | 'scheduled' | 'published';

export interface VideoListParams {
  limit?: number;
  cursor?: string;
  channelId?: string;
  channelIds?: string[];
  userId?: string;
  category?: VideoCategory;
  tags?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  durationFilter?: VideoDurationFilter;
  scheduleFilter?: VideoScheduleFilter;
  isOwner?: boolean;
  sortBy?: 'dateCreated' | 'views' | 'likesCount' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface VideoUploadMetadata {
  title: string;
  description?: string;
  channelId?: string;
  tags?: string[];
  category?: VideoCategory;
  language?: string;
  isPublic?: boolean;
  thumbnail?: {
    type: 'auto' | 'custom';
    data?: string; // Base64 for custom thumbnails
    position?: number; // Frame position (0-100) for auto-generated
    filename?: string;
  };
}

export interface VideoUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  error?: string;
}

// Scheduling-related types
export interface VideoScheduleRequest {
  videoId: string;
  scheduledPublishDate: string;     // ISO 8601 datetime
  timezone: string;                  // IANA timezone
  notifyOnPublish?: boolean;         // Send notification
  premiereMode?: boolean;            // Enable premiere (future)
}

export interface VideoScheduleUpdateRequest {
  scheduledPublishDate?: string;
  timezone?: string;
  notifyOnPublish?: boolean;
}

export interface ScheduledVideoMetadata {
  videoId: string;
  title: string;
  channelId: string;
  userId: string;
  scheduledPublishDate: string;      // UTC datetime
  timezone: string;
  localScheduledDate: string;        // User's local time
  notifyOnPublish: boolean;
  retryCount: number;
  lastAttempt?: string;
  error?: string;
}

export interface VideoScheduleResponse {
  videoId: string;
  scheduledPublishDate: string;
  localScheduledDate: string;
  timezone: string;
  status: ScheduledPublishStatus;
}

export interface ScheduledVideoListResponse {
  videos: ScheduledVideoInfo[];
  cursor?: string;
  hasMore: boolean;
}

export interface ScheduledVideoInfo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  thumbnailType?: 'auto' | 'custom'; // Type of thumbnail (auto-generated or custom)
  thumbnailSizes?: {
    hd?: string;    // 1280x720
    sd?: string;    // 640x360
    mobile?: string; // 320x180
    thumb?: string;  // 120x90
  };
  scheduledPublishDate: string;
  localScheduledDate: string;
  timezone: string;
  status: ScheduledPublishStatus;
  timeRemaining?: string;
  canEdit: boolean;
  canCancel: boolean;
}

/**
 * Live Stream Types
 */
export type StreamStatus = 'live' | 'scheduled' | 'ended' | 'offline';

export interface LiveStream {
  id: string;
  title: string;
  thumbnailUrl: string;
  status: StreamStatus;
  viewerCount?: number;
  channel: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  category?: string;
  startedAt?: Date;
  scheduledStartTime?: Date;
  endedAt?: Date;
  duration?: number; // seconds
}
