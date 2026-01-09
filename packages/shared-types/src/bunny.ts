/**
 * Bunny.net Stream and Storage Types
 * Shared types for Bunny.net integration across apps
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for Bunny.net Stream service
 */
export interface BunnyConfig {
  /** Pull Zone URL (e.g., "vz-xxxxx.b-cdn.net") */
  pullZoneUrl: string;
  /** Bunny.net library ID */
  libraryId: string;
  /** API key for authenticated requests */
  apiKey?: string;
  /** Enable token-based authentication */
  tokenAuthEnabled?: boolean;
  /** Storage zone name for images */
  storageZone?: string;
}

// ============================================================================
// Video Quality
// ============================================================================

/**
 * Supported video quality levels
 */
export type VideoQuality = '240p' | '360p' | '480p' | '720p' | '1080p';

/**
 * Map of video quality to resolution height
 */
export const QualityResolutionMap: Record<VideoQuality, number> = {
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};

// ============================================================================
// URL Types
// ============================================================================

/**
 * Collection of all video URLs for different qualities and formats
 */
export interface BunnyVideoUrls {
  /** HLS playlist URL for adaptive streaming */
  hls: string;
  /** MP4 direct URLs for each quality level */
  mp4: Partial<Record<VideoQuality, string>>;
  /** Thumbnail URL (with optional timestamp) */
  thumbnail: string;
  /** Preview animation/GIF URL */
  preview: string;
  /** Captions/subtitles URLs */
  captions?: BunnyCaptionUrl[];
}

/**
 * Caption/subtitle URL with language information
 */
export interface BunnyCaptionUrl {
  /** Language code (e.g., "en", "ar") */
  srclang: string;
  /** Human-readable label (e.g., "English", "Arabic") */
  label: string;
  /** Caption file URL */
  url: string;
}

/**
 * Options for generating thumbnail URLs
 */
export interface ThumbnailOptions {
  /** Timestamp in seconds for thumbnail snapshot */
  timestamp?: number;
  /** Thumbnail width in pixels */
  width?: number;
  /** Thumbnail height in pixels */
  height?: number;
}

/**
 * Options for generating authenticated URLs
 */
export interface TokenOptions {
  /** Expiration time in seconds from now */
  expiresIn?: number;
  /** IP address to restrict access to */
  ipAddress?: string;
  /** Additional security token */
  token?: string;
}

// ============================================================================
// Bunny.net API Response Models
// ============================================================================

/**
 * Bunny.net Collection model
 */
export interface BunnyCollectionModel {
  videoLibraryId: number;
  guid?: string;
  name?: string;
  videoCount: number;
  totalSize: number;
  previewVideoIds?: string;
  previewImageUrls?: string[];
}

/**
 * Bunny.net Video model (API response)
 */
export interface BunnyVideoModel {
  videoLibraryId: number;
  guid?: string;
  title?: string;
  dateUploaded?: string; // ISO 8601 format
  views: number;
  isPublic: boolean;
  length: number;
  status: BunnyVideoStatus;
  framerate: number;
  rotation?: number;
  width: number;
  height: number;
  availableResolutions?: string;
  thumbnailCount: number;
  encodeProgress: number;
  storageSize: number;
  captions?: BunnyCaptionModel[];
  hasMP4Fallback: boolean;
  collectionId?: string;
  thumbnailFileName?: string;
  averageWatchTime: number;
  totalWatchTime: number;
  category?: string;
  chapters?: BunnyChapterModel[];
  moments?: BunnyMomentModel[];
  metaTags?: BunnyMetaTagModel[];
  transcodingMessages?: BunnyTranscodingMessageModel[];
}

/**
 * Video status codes from Bunny.net
 */
export enum BunnyVideoStatus {
  Created = 0,
  Uploaded = 1,
  Processing = 2,
  Transcoding = 3,
  Finished = 4,
  Error = 5,
  UploadFailed = 6,
}

/**
 * Caption/subtitle model from Bunny.net
 */
export interface BunnyCaptionModel {
  srclang?: string;
  label?: string;
}

/**
 * Video chapter model
 */
export interface BunnyChapterModel {
  title: string;
  start: number;
  end: number;
}

/**
 * Video moment/marker model
 */
export interface BunnyMomentModel {
  label: string;
  timestamp: number;
}

/**
 * Video meta tag model
 */
export interface BunnyMetaTagModel {
  property?: string;
  value?: string;
}

/**
 * Transcoding message model
 */
export interface BunnyTranscodingMessageModel {
  timeStamp: string; // ISO 8601 format
  level: BunnyTranscodingLevel;
  issueCode: BunnyTranscodingIssueCode;
  message?: string;
  value?: string;
}

/**
 * Transcoding message levels
 */
export enum BunnyTranscodingLevel {
  Undefined = 0,
  Information = 1,
  Warning = 2,
  Error = 3,
}

/**
 * Transcoding issue codes
 */
export enum BunnyTranscodingIssueCode {
  Undefined = 0,
  StreamLengthsDifference = 1,
  AudioStreamMissing = 2,
  VideoStreamMissing = 3,
  InvalidFormat = 4,
}

// ============================================================================
// Upload Types
// ============================================================================

/**
 * Bunny.net upload signature response
 */
export interface BunnyUploadSignature {
  signature: string;
  expirationTime: number;
  libraryId: string;
  videoId: string;
}

/**
 * Upload progress data
 */
export interface BunnyUploadProgress {
  videoId: string;
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}
