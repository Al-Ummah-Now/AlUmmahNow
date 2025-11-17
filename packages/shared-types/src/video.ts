/**
 * Video-related types
 * These types are shared between frontend and backend
 */

import { Timestamps } from './common';

export interface VideoObject extends Timestamps {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>; // Multi-language titles
  description: string | null;
  descriptionLocalized?: Record<string, string>; // Multi-language descriptions
  thumbnailUrl: string;
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

  // Timestamps
  dateCreated: string;
  dateModified: string;
  publishedAt?: string;
}

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
}

export interface VideoUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  error?: string;
}
