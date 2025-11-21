/**
 * Video-related types
 * These types are shared between frontend and backend
 */

import { Timestamps } from './common';
import { SubtitleTrack } from './subtitle';

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

export interface VideoObject extends Timestamps {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>; // Multi-language titles
  description: string | null;
  descriptionLocalized?: Record<string, string>; // Multi-language descriptions
  thumbnailUrl: string;
  thumbnailType?: 'auto' | 'custom'; // Type of thumbnail (auto-generated or custom)
  thumbnailSizes?: {
    hd?: string;    // 1280x720
    sd?: string;    // 640x360
    mobile?: string; // 320x180
    thumb?: string;  // 120x90
  };
  videoUrl: string;
  userId: string;
  channelId: string | null;
  channel: string;
  channelName: string;
  channelAvatarUrl: string;

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

  // Status and visibility
  isPublic?: boolean;
  isLive?: boolean;
  isFeatured?: boolean;
  processingStatus?: VideoProcessingStatus;

  // SEO and categorization
  tags?: string[];
  category?: string;
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
  category?: string;
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
  category?: string;
  language?: string;
}

export interface VideoListParams {
  limit?: number;
  cursor?: string;
  channelId?: string;
  userId?: string;
  category?: string;
  tags?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  sortBy?: 'dateCreated' | 'views' | 'likesCount' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface VideoUploadMetadata {
  title: string;
  description?: string;
  channelId?: string;
  tags?: string[];
  category?: string;
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
